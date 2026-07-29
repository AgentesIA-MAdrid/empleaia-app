/**
 * Objetivos de venta del mes (módulo "Cierre de turno", plan Enterprise).
 *
 * GET  /api/objetivos-venta?mes=YYYY-MM&ambito=comercial|sede&articuloId=…
 *   Devuelve la tabla lista para pintar: una fila por comercial (o por sede),
 *   con su objetivo del mes, lo vendido y la consecución. `articuloId` vacío =
 *   objetivo de unidades totales.
 *
 * PUT  /api/objetivos-venta — fija (o borra, con cantidad 0) un objetivo.
 * DELETE /api/objetivos-venta?id=… — quita un objetivo.
 *
 * Quién ve qué: administración toda la empresa, coordinación solo su sede y en
 * modo lectura (`puedeFijarObjetivos`). Un comercial no entra aquí: su progreso
 * lo ve en el paso 2 del cierre (`/api/cierre-turno/progreso`).
 */

import { auth } from "@/lib/auth";
import { prismaApp as prisma } from "@/lib/prisma";
import { NextResponse, type NextRequest } from "next/server";

import { withTenant } from "@/lib/tenant/with-tenant";
import { withFeature } from "@/lib/feature-guard/with-feature";
import { diaMadrid, puedeFijarObjetivos, puedeVerObjetivos } from "@/lib/cierre-turno/core";
import {
  ambitoDe,
  normalizarCantidadObjetivo,
  normalizarMes,
  vendidoDeSujeto,
  type AmbitoObjetivo,
} from "@/lib/cierre-turno/objetivos";
import {
  preciosActivos as leerPreciosActivos,
  ventasAgregadas,
} from "@/lib/cierre-turno/ventas-queries";

/** Consecución con la misma regla que el resto del módulo (sin objetivo, null). */
function pct(vendido: number, objetivo: number | null): number | null {
  if (objetivo === null || objetivo <= 0) return null;
  return Math.round((vendido / objetivo) * 1000) / 10;
}

interface Sesion {
  userId: string;
  rol: string;
  tiendaId: string | null;
}

async function sesion(): Promise<Sesion | null> {
  const session = await auth();
  if (!session?.user) return null;
  return {
    userId: session.user.id!,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rol: (session.user as any).rol as string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tiendaId: ((session.user as any).tiendaId as string | null) ?? null,
  };
}

export const GET = withTenant(
  withFeature("cierre_turno", async (req: NextRequest) => {
    const s = await sesion();
    if (!s) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    if (!puedeVerObjetivos(s.rol)) {
      return NextResponse.json(
        { error: "Los objetivos de venta los consultan administración y coordinación." },
        { status: 403 },
      );
    }

    const url = new URL(req.url);
    const mesPedido = url.searchParams.get("mes") ?? diaMadrid().slice(0, 7);
    const mesOk = normalizarMes(mesPedido);
    if (!mesOk.ok) return NextResponse.json({ error: mesOk.error }, { status: 400 });
    const mes = mesOk.mes;

    const ambito: AmbitoObjetivo = url.searchParams.get("ambito") === "sede" ? "sede" : "comercial";
    const articuloId = url.searchParams.get("articuloId") || null;

    // El coordinador va atado a su sede aunque pida otra.
    const sedeFiltro = s.rol === "OWNER" ? url.searchParams.get("tiendaId") || null : s.tiendaId;

    const [objetivos, ventas, articulos, sedes, personas, preciosOn] = await Promise.all([
      prisma.objetivoVenta.findMany({
        where: { mes },
        select: { id: true, mes: true, userId: true, tiendaId: true, articuloId: true, cantidad: true },
      }),
      ventasAgregadas(prisma, { mes, tiendaId: sedeFiltro }),
      prisma.articuloVenta.findMany({
        where: { activo: true },
        select: { id: true, nombre: true, categoria: true, precio: true },
        orderBy: [{ orden: "asc" }, { nombre: "asc" }],
      }),
      prisma.tienda.findMany({
        where: { activa: true, ...(sedeFiltro ? { id: sedeFiltro } : {}) },
        select: { id: true, nombre: true },
        orderBy: { nombre: "asc" },
      }),
      prisma.user.findMany({
        where: { activo: true, ...(sedeFiltro ? { tiendaId: sedeFiltro } : {}) },
        select: { id: true, nombre: true, apellidos: true, tiendaId: true },
        orderBy: [{ apellidos: "asc" }, { nombre: "asc" }],
      }),
      leerPreciosActivos(prisma),
    ]);

    const precios = new Map(articulos.map((a) => [a.id, a.precio === null ? null : Number(a.precio)]));
    const precioArticulo = articuloId ? (precios.get(articuloId) ?? null) : null;
    const nombreSede = new Map(sedes.map((t) => [t.id, t.nombre]));

    // Objetivo ya fijado para cada sujeto, en el artículo elegido (o en el
    // total). La clave incluye el artículo porque un comercial puede tener a la
    // vez objetivo total y objetivo de un artículo concreto.
    const clave = (o: { userId: string | null; tiendaId: string | null; articuloId: string | null }) =>
      `${o.userId ?? ""}|${o.tiendaId ?? ""}|${o.articuloId ?? ""}`;
    const porClave = new Map(objetivos.map((o) => [clave(o), o]));

    const sujetos =
      ambito === "sede"
        ? sedes.map((t) => ({ id: t.id, nombre: t.nombre, sede: null as string | null }))
        : personas.map((p) => ({
            id: p.id,
            nombre: `${p.nombre} ${p.apellidos}`.trim(),
            sede: p.tiendaId ? (nombreSede.get(p.tiendaId) ?? null) : null,
          }));

    const filas = sujetos.map((suj) => {
      const objetivo = porClave.get(
        clave({
          userId: ambito === "comercial" ? suj.id : null,
          tiendaId: ambito === "sede" ? suj.id : null,
          articuloId,
        }),
      );
      const vendido = vendidoDeSujeto(ventas, { ambito, id: suj.id }, articuloId);
      return {
        sujetoId: suj.id,
        sujeto: suj.nombre,
        sede: suj.sede,
        objetivoId: objetivo?.id ?? null,
        objetivo: objetivo?.cantidad ?? null,
        vendido,
        consecucion: pct(vendido, objetivo?.cantidad ?? null),
        // Importe solo si el cliente trabaja con precios Y estamos mirando un
        // artículo concreto: sumar euros de artículos distintos con precios a
        // medio poner daría un total que nadie podría cuadrar.
        importe:
          preciosOn && articuloId && precioArticulo !== null
            ? Math.round(vendido * precioArticulo * 100) / 100
            : null,
      };
    });

    // Vista de todos los objetivos del mes, para revisarlos y borrarlos sin ir
    // artículo por artículo.
    const nombrePersona = new Map(personas.map((p) => [p.id, `${p.nombre} ${p.apellidos}`.trim()]));
    const nombreArticulo = new Map(articulos.map((a) => [a.id, a.nombre]));
    const todos = objetivos
      .map((o) => {
        const amb = ambitoDe(o);
        if (!amb) return null;
        const sujetoId = (amb === "comercial" ? o.userId : o.tiendaId) as string;
        const nombre = amb === "comercial" ? nombrePersona.get(sujetoId) : nombreSede.get(sujetoId);
        // Un objetivo de alguien que ya no está (o de otra sede, para el
        // coordinador) no se pinta: no es suyo ni puede hacer nada con él.
        if (!nombre) return null;
        const vendido = vendidoDeSujeto(ventas, { ambito: amb, id: sujetoId }, o.articuloId);
        return {
          id: o.id,
          ambito: amb,
          sujeto: nombre,
          articulo: o.articuloId ? (nombreArticulo.get(o.articuloId) ?? "Artículo retirado") : null,
          objetivo: o.cantidad,
          vendido,
          consecucion: pct(vendido, o.cantidad),
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)
      .sort((a, b) => a.sujeto.localeCompare(b.sujeto, "es") || (a.articulo ?? "").localeCompare(b.articulo ?? "", "es"));

    return NextResponse.json({
      mes,
      ambito,
      articuloId,
      soloLectura: !puedeFijarObjetivos(s.rol),
      preciosActivos: preciosOn,
      articulos: articulos.map((a) => ({
        id: a.id,
        nombre: a.nombre,
        categoria: a.categoria,
        precio: a.precio === null ? null : Number(a.precio),
      })),
      sedes,
      filas,
      objetivosDelMes: todos,
      resumen: {
        objetivo: filas.reduce((n, f) => n + (f.objetivo ?? 0), 0),
        vendido: filas.reduce((n, f) => n + f.vendido, 0),
        conObjetivo: filas.filter((f) => f.objetivo !== null).length,
      },
    });
  }),
);

export const PUT = withTenant(
  withFeature("cierre_turno", async (req: NextRequest) => {
    const s = await sesion();
    if (!s) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    if (!puedeFijarObjetivos(s.rol)) {
      return NextResponse.json(
        { error: "Solo un administrador puede fijar objetivos de venta." },
        { status: 403 },
      );
    }

    const body = (await req.json().catch(() => null)) as {
      mes?: unknown;
      ambito?: unknown;
      sujetoId?: unknown;
      articuloId?: unknown;
      cantidad?: unknown;
    } | null;
    if (!body) return NextResponse.json({ error: "Datos no válidos" }, { status: 400 });

    const mesOk = normalizarMes(body.mes);
    if (!mesOk.ok) return NextResponse.json({ error: mesOk.error }, { status: 400 });
    const cantidadOk = normalizarCantidadObjetivo(body.cantidad);
    if (!cantidadOk.ok) return NextResponse.json({ error: cantidadOk.error }, { status: 400 });

    const ambito: AmbitoObjetivo = body.ambito === "sede" ? "sede" : "comercial";
    if (typeof body.sujetoId !== "string" || !body.sujetoId) {
      return NextResponse.json({ error: "Falta a quién es el objetivo." }, { status: 400 });
    }
    const articuloId = typeof body.articuloId === "string" && body.articuloId ? body.articuloId : null;

    // Comprobar que el destinatario y el artículo existen: un objetivo de un id
    // inventado no se vería en ninguna pantalla y quedaría de basura en la tabla.
    if (ambito === "comercial") {
      const existe = await prisma.user.findUnique({ where: { id: body.sujetoId }, select: { id: true } });
      if (!existe) return NextResponse.json({ error: "Ese empleado no existe." }, { status: 404 });
    } else {
      const existe = await prisma.tienda.findUnique({ where: { id: body.sujetoId }, select: { id: true } });
      if (!existe) return NextResponse.json({ error: "Esa sede no existe." }, { status: 404 });
    }
    if (articuloId) {
      const existe = await prisma.articuloVenta.findUnique({
        where: { id: articuloId },
        select: { id: true },
      });
      if (!existe) return NextResponse.json({ error: "Ese artículo no existe." }, { status: 404 });
    }

    const donde = {
      mes: mesOk.mes,
      userId: ambito === "comercial" ? body.sujetoId : null,
      tiendaId: ambito === "sede" ? body.sujetoId : null,
      articuloId,
    };

    // No se usa `upsert` sobre la clave única (mes, userId, tiendaId,
    // articuloId): en Postgres dos NULL no son iguales, así que la unique no
    // dedupe las combinaciones con hueco y el upsert crearía duplicados. Con
    // findFirst + update/create dentro de una transacción sí queda una sola
    // fila por combinación.
    const resultado = await prisma.$transaction(async (tx) => {
      const previo = await tx.objetivoVenta.findFirst({ where: donde, select: { id: true } });

      if (cantidadOk.cantidad === 0) {
        if (previo) await tx.objetivoVenta.delete({ where: { id: previo.id } });
        return { borrado: true as const };
      }
      if (previo) {
        const act = await tx.objetivoVenta.update({
          where: { id: previo.id },
          data: { cantidad: cantidadOk.cantidad },
          select: { id: true, cantidad: true },
        });
        return { borrado: false as const, ...act };
      }
      const nuevo = await tx.objetivoVenta.create({
        data: { ...donde, cantidad: cantidadOk.cantidad },
        select: { id: true, cantidad: true },
      });
      return { borrado: false as const, ...nuevo };
    });

    return NextResponse.json(resultado);
  }),
);

export const DELETE = withTenant(
  withFeature("cierre_turno", async (req: NextRequest) => {
    const s = await sesion();
    if (!s) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    if (!puedeFijarObjetivos(s.rol)) {
      return NextResponse.json(
        { error: "Solo un administrador puede quitar objetivos de venta." },
        { status: 403 },
      );
    }
    const id = new URL(req.url).searchParams.get("id");
    if (!id) return NextResponse.json({ error: "Falta el objetivo." }, { status: 400 });

    const previo = await prisma.objetivoVenta.findUnique({ where: { id }, select: { id: true } });
    if (!previo) return NextResponse.json({ error: "Ese objetivo ya no existe." }, { status: 404 });
    await prisma.objetivoVenta.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  }),
);
