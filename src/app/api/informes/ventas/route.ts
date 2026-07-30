/**
 * GET /api/informes/ventas — informe de ventas del módulo "Cierre de turno".
 *
 *   ?desde=YYYY-MM-DD&hasta=YYYY-MM-DD  (rango inclusivo por días)
 *   ?tiendaId=…   sede (el coordinador va atado a la suya)
 *   ?userId=…     un comercial concreto
 *
 * Devuelve lo vendido en el periodo por artículo, por comercial y por sede, y
 * al lado lo que se declaró en caja. Ese cruce es la pregunta que se hace
 * administración: "hemos vendido esto, ¿está el dinero?".
 *
 * El importe solo aparece si el cliente trabaja con precios; los artículos sin
 * precio se cuentan aparte en vez de sumar cero y dar un total que no cuadra
 * con nada.
 */

import { auth } from "@/lib/auth";
import { prismaApp as prisma } from "@/lib/prisma";
import { NextResponse, type NextRequest } from "next/server";

import { withTenant } from "@/lib/tenant/with-tenant";
import { withFeature } from "@/lib/feature-guard/with-feature";
import { alcanceSegunRol, diaMadrid } from "@/lib/cierre-turno/core";
import { importeVendido } from "@/lib/cierre-turno/objetivos";
import {
  preciosActivos as leerPreciosActivos,
  ventasAgregadas,
} from "@/lib/cierre-turno/ventas-queries";

const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Tope del rango: un año. Más allá, el informe deja de ser una consulta. */
const MAX_DIAS = 366;

export const GET = withTenant(
  withFeature("cierre_turno", async (req: NextRequest) => {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rol = (session.user as any).rol as string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tiendaPropia = ((session.user as any).tiendaId as string | null) ?? null;

    const alcance = alcanceSegunRol(rol);
    if (alcance === "propio") {
      return NextResponse.json(
        { error: "El informe de ventas es de administración y coordinación." },
        { status: 403 },
      );
    }

    const url = new URL(req.url);
    const hoy = diaMadrid();
    const desdeStr = url.searchParams.get("desde") ?? hoy.slice(0, 8) + "01";
    const hastaStr = url.searchParams.get("hasta") ?? hoy;
    if (!FECHA_RE.test(desdeStr) || !FECHA_RE.test(hastaStr)) {
      return NextResponse.json({ error: "Las fechas tienen que venir como AAAA-MM-DD." }, { status: 400 });
    }
    const desde = new Date(`${desdeStr}T00:00:00Z`);
    // El rango que llega es inclusivo; internamente se usa `[desde, hasta)`.
    const hasta = new Date(new Date(`${hastaStr}T00:00:00Z`).getTime() + 86_400_000);
    if (!(desde < hasta)) {
      return NextResponse.json({ error: "La fecha de inicio es posterior a la de fin." }, { status: 400 });
    }
    if ((hasta.getTime() - desde.getTime()) / 86_400_000 > MAX_DIAS) {
      return NextResponse.json({ error: "El periodo no puede pasar de un año." }, { status: 400 });
    }

    // El coordinador no puede ampliar el alcance por querystring.
    const tiendaId = alcance === "sede" ? tiendaPropia : url.searchParams.get("tiendaId") || null;
    const userId = url.searchParams.get("userId") || null;

    const [ventas, articulos, personas, sedes, caja, preciosOn, cierres] = await Promise.all([
      ventasAgregadas(prisma, { desde, hasta, tiendaId, userId }),
      prisma.articuloVenta.findMany({
        select: { id: true, nombre: true, categoria: true, precio: true },
        orderBy: [{ orden: "asc" }, { nombre: "asc" }],
      }),
      prisma.user.findMany({ select: { id: true, nombre: true, apellidos: true, tiendaId: true } }),
      prisma.tienda.findMany({ select: { id: true, nombre: true } }),
      prisma.cierreCaja.aggregate({
        where: {
          fecha: { gte: desde, lt: hasta },
          ...(tiendaId ? { tiendaId } : {}),
          ...(userId ? { cierre: { userId } } : {}),
        },
        _sum: { efectivo: true, tarjeta: true },
        _count: true,
      }),
      leerPreciosActivos(prisma),
      prisma.cierreTurno.count({
        where: {
          fecha: { gte: desde, lt: hasta },
          ...(tiendaId ? { tiendaId } : {}),
          ...(userId ? { userId } : {}),
        },
      }),
    ]);

    const precios = new Map(articulos.map((a) => [a.id, a.precio === null ? null : Number(a.precio)]));
    const nombreArticulo = new Map(articulos.map((a) => [a.id, a.nombre]));
    const categoriaArticulo = new Map(articulos.map((a) => [a.id, a.categoria]));
    const nombreSede = new Map(sedes.map((t) => [t.id, t.nombre]));
    const persona = new Map(personas.map((p) => [p.id, p]));

    /** Importe de un grupo de ventas, o null si el cliente no usa precios. */
    const importeDe = (grupo: typeof ventas) =>
      preciosOn ? importeVendido(grupo, precios).importe : null;

    // ─── Por artículo ─────────────────────────────────────────────────────
    const porArticuloMap = new Map<string, { unidades: number }>();
    for (const v of ventas) {
      const clave = v.articuloId ?? "";
      const previo = porArticuloMap.get(clave);
      if (previo) previo.unidades += v.cantidad;
      else porArticuloMap.set(clave, { unidades: v.cantidad });
    }
    const porArticulo = [...porArticuloMap.entries()]
      .map(([id, { unidades }]) => {
        const precio = id ? (precios.get(id) ?? null) : null;
        return {
          articuloId: id || null,
          // Las ventas de un artículo ya borrado del catálogo se siguen viendo:
          // el histórico tiene que cuadrar aunque el artículo ya no exista.
          nombre: id ? (nombreArticulo.get(id) ?? "Artículo retirado") : "Artículo retirado",
          categoria: id ? (categoriaArticulo.get(id) ?? null) : null,
          unidades,
          precio: preciosOn ? precio : null,
          importe: preciosOn && precio !== null ? Math.round(unidades * precio * 100) / 100 : null,
        };
      })
      .sort((a, b) => b.unidades - a.unidades);

    // ─── Por comercial ────────────────────────────────────────────────────
    const porComercialMap = new Map<string, typeof ventas>();
    for (const v of ventas) {
      const lista = porComercialMap.get(v.userId) ?? [];
      lista.push(v);
      porComercialMap.set(v.userId, lista);
    }
    const porComercial = [...porComercialMap.entries()]
      .map(([id, grupo]) => {
        const p = persona.get(id);
        return {
          userId: id,
          nombre: p ? `${p.nombre} ${p.apellidos}`.trim() : "Empleado dado de baja",
          sede: p?.tiendaId ? (nombreSede.get(p.tiendaId) ?? null) : null,
          unidades: grupo.reduce((n, v) => n + v.cantidad, 0),
          importe: importeDe(grupo),
        };
      })
      .sort((a, b) => b.unidades - a.unidades);

    // ─── Por sede ─────────────────────────────────────────────────────────
    const porSedeMap = new Map<string, typeof ventas>();
    for (const v of ventas) {
      const clave = v.tiendaId ?? "";
      const lista = porSedeMap.get(clave) ?? [];
      lista.push(v);
      porSedeMap.set(clave, lista);
    }
    const porSede = [...porSedeMap.entries()]
      .map(([id, grupo]) => ({
        tiendaId: id || null,
        nombre: id ? (nombreSede.get(id) ?? "Sede eliminada") : "Sin sede",
        unidades: grupo.reduce((n, v) => n + v.cantidad, 0),
        importe: importeDe(grupo),
      }))
      .sort((a, b) => b.unidades - a.unidades);

    const { importe, unidadesSinPrecio } = importeVendido(ventas, precios);
    const efectivo = Number(caja._sum.efectivo ?? 0);
    const tarjeta = Number(caja._sum.tarjeta ?? 0);

    return NextResponse.json({
      desde: desdeStr,
      hasta: hastaStr,
      alcance,
      preciosActivos: preciosOn,
      porArticulo,
      porComercial,
      porSede,
      totales: {
        unidades: ventas.reduce((n, v) => n + v.cantidad, 0),
        importe: preciosOn ? importe : null,
        unidadesSinPrecio: preciosOn ? unidadesSinPrecio : 0,
        cierres,
        cajas: caja._count,
        efectivo,
        tarjeta,
        caja: Math.round((efectivo + tarjeta) * 100) / 100,
      },
    });
  }),
);
