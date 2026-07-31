/**
 * Objetivos de venta del mes (módulo "Cierre de turno", plan Enterprise).
 *
 * GET  /api/objetivos-venta?mes=YYYY-MM
 *   Devuelve las dos matrices listas para pintar: una fila por comercial y otra
 *   tanda de filas por sede, con una columna por artículo del catálogo (más la
 *   de unidades totales) y en cada casilla el objetivo del mes, lo vendido y la
 *   consecución. Los objetivos personales y los de la sede son distintos y van
 *   en tablas separadas.
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
import { diaMadrid, filtroSede, puedeFijarObjetivos, puedeVerObjetivos } from "@/lib/cierre-turno/core";
import {
  ambitoDe,
  COLUMNA_TOTAL,
  construirMatriz,
  normalizarCantidadObjetivo,
  normalizarMes,
  totalesMatriz,
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

    // El coordinador va atado a su sede aunque pida otra. Sin sede asignada no
    // ve todas las sedes: no ve ninguna (ver `filtroSede`).
    const filtro = filtroSede(s.rol, s.tiendaId, url.searchParams.get("tiendaId"));
    if (filtro.tipo === "ninguna") {
      return NextResponse.json({
        mes,
        soloLectura: true,
        preciosActivos: false,
        articulos: [],
        filasComerciales: [],
        filasSedes: [],
        totalesComerciales: {},
        totalesSedes: {},
        objetivosDelMes: [],
        resumen: { objetivo: 0, vendido: 0, conObjetivo: 0 },
        sinSede: true,
      });
    }
    const sedeFiltro = filtro.tipo === "sede" ? filtro.tiendaId : null;

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
    const nombreSede = new Map(sedes.map((t) => [t.id, t.nombre]));
    const articuloIds = articulos.map((a) => a.id);

    // Dos matrices independientes: los objetivos personales y los de la sede son
    // objetivos distintos y no se suman entre sí.
    const filasComerciales = construirMatriz(
      "comercial",
      personas.map((p) => ({
        id: p.id,
        nombre: `${p.nombre} ${p.apellidos}`.trim(),
        sede: p.tiendaId ? (nombreSede.get(p.tiendaId) ?? null) : null,
      })),
      articuloIds,
      objetivos,
      ventas,
    );
    const filasSedes = construirMatriz(
      "sede",
      sedes.map((t) => ({ id: t.id, nombre: t.nombre })),
      articuloIds,
      objetivos,
      ventas,
    );

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
        // Importe solo si el cliente trabaja con precios Y el objetivo es de un
        // artículo concreto con precio: sumar euros de artículos distintos con
        // precios a medio poner daría un total que nadie podría cuadrar.
        const precio = o.articuloId ? (precios.get(o.articuloId) ?? null) : null;
        return {
          id: o.id,
          ambito: amb,
          sujeto: nombre,
          articulo: o.articuloId ? (nombreArticulo.get(o.articuloId) ?? "Artículo retirado") : null,
          objetivo: o.cantidad,
          vendido,
          consecucion: pct(vendido, o.cantidad),
          importe: preciosOn && precio !== null ? Math.round(vendido * precio * 100) / 100 : null,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)
      .sort((a, b) => a.sujeto.localeCompare(b.sujeto, "es") || (a.articulo ?? "").localeCompare(b.articulo ?? "", "es"));

    const totalesComerciales = totalesMatriz(filasComerciales, articuloIds);
    const totalesSedes = totalesMatriz(filasSedes, articuloIds);

    return NextResponse.json({
      mes,
      soloLectura: !puedeFijarObjetivos(s.rol),
      preciosActivos: preciosOn,
      articulos: articulos.map((a) => ({
        id: a.id,
        nombre: a.nombre,
        categoria: a.categoria,
        precio: a.precio === null ? null : Number(a.precio),
      })),
      filasComerciales,
      filasSedes,
      totalesComerciales,
      totalesSedes,
      objetivosDelMes: todos,
      // Las tarjetas de arriba miden el objetivo de unidades totales de los
      // comerciales: el fijado a mano o, donde no lo haya, la suma de sus
      // objetivos por producto (`objetivoTotalDe`). Lo de cada producto y lo de
      // cada sede se lee en el pie de su tabla, que es donde tiene sentido.
      resumen: {
        objetivo: totalesComerciales[COLUMNA_TOTAL]?.objetivo ?? 0,
        vendido: totalesComerciales[COLUMNA_TOTAL]?.vendido ?? 0,
        conObjetivo: totalesComerciales[COLUMNA_TOTAL]?.conObjetivo ?? 0,
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
