/**
 * GET /api/conciliacion/tarjeta?tiendaId=&desde=&hasta=&desfase= — el cuadre de
 * tarjeta de una tienda, día a día (ticket 1e73c9a4).
 *
 * Lo que la tienda dice haber cobrado con el datáfono un día, frente a lo que el
 * banco ingresó **al día siguiente**: las liquidaciones entran con desfase, así
 * que comparar el mismo día marcaría descuadre en todas partes —un día con
 * ventas y sin ingreso, y otro con ingreso y sin ventas—.
 *
 * El desfase por defecto es un día, que es lo que hace el datáfono de este
 * cliente. Se puede cambiar con `?desfase=` para un banco que liquide distinto,
 * o ponerlo a 0 para comparar el mismo día.
 *
 * Los movimientos del banco salen de `MovimientoBanco`, que se importa del Excel
 * del extracto (ver `/api/movimientos-banco`). Los que no tienen tienda asignada
 * no se pueden atribuir y se cuentan aparte, para que no parezca que falta
 * dinero de esta.
 *
 * Solo administración: cruza el extracto de la cuenta de la empresa.
 */

import { auth } from "@/lib/auth";
import { prismaApp as prisma } from "@/lib/prisma";
import { NextResponse, type NextRequest } from "next/server";

import { withTenant } from "@/lib/tenant/with-tenant";
import { withFeature } from "@/lib/feature-guard/with-feature";
import { cuadreTarjeta, DESFASE_BANCO_DIAS, sumarDias } from "@/lib/cierre-turno/cuadre-diario";
import { rangoExclusivo, umbralDescuadre } from "@/lib/cierre-turno/caja-queries";

const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;

export const GET = withTenant(
  withFeature("cierre_turno", async (req: NextRequest) => {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if ((session.user as any).rol !== "OWNER") {
      return NextResponse.json(
        { error: "Solo administración ve la conciliación." },
        { status: 403 },
      );
    }

    const url = new URL(req.url);
    const tiendaId = url.searchParams.get("tiendaId") ?? "";
    const desdeStr = url.searchParams.get("desde") ?? "";
    const hastaStr = url.searchParams.get("hasta") ?? "";
    if (!tiendaId || !FECHA_RE.test(desdeStr) || !FECHA_RE.test(hastaStr)) {
      return NextResponse.json({ error: "Faltan la tienda y el rango de fechas." }, { status: 400 });
    }
    // Ojo con el parámetro ausente: `Number(null)` es 0, y un 0 aquí significa
    // "compara el mismo día", que es justo lo que este cuadre viene a evitar.
    const desfaseCrudo = url.searchParams.get("desfase");
    const desfasePedido = desfaseCrudo === null ? NaN : Number(desfaseCrudo);
    const desfase =
      Number.isInteger(desfasePedido) && desfasePedido >= 0 && desfasePedido <= 7
        ? desfasePedido
        : DESFASE_BANCO_DIAS;

    const desde = new Date(`${desdeStr}T00:00:00Z`);
    const hasta = new Date(`${hastaStr}T00:00:00Z`);
    if (hasta < desde) {
      return NextResponse.json({ error: "El rango está del revés." }, { status: 400 });
    }
    // El extracto se mira desplazado: los ingresos de las ventas del último día
    // del rango entran después.
    const desdeBanco = new Date(`${sumarDias(desdeStr, desfase)}T00:00:00Z`);
    const hastaBanco = new Date(`${sumarDias(hastaStr, desfase)}T00:00:00Z`);

    const tienda = await prisma.tienda.findUnique({
      where: { id: tiendaId },
      select: { id: true, nombre: true },
    });
    if (!tienda) return NextResponse.json({ error: "Esa tienda no existe." }, { status: 404 });

    const [cajas, movimientos, umbral] = await Promise.all([
      prisma.cierreCaja.groupBy({
        by: ["fecha"],
        where: { tiendaId, fecha: rangoExclusivo(desde, hasta), confirmadoEn: { not: null } },
        _sum: { tarjeta: true },
      }),
      prisma.movimientoBanco.findMany({
        where: { tiendaId, fecha: rangoExclusivo(desdeBanco, hastaBanco) },
        select: { id: true, fecha: true, importe: true, concepto: true, referencia: true },
        orderBy: { fecha: "asc" },
      }),
      umbralDescuadre(prisma),
    ]);

    const declaradoPorDia = new Map<string, number>();
    for (const c of cajas) {
      declaradoPorDia.set(c.fecha.toISOString().slice(0, 10), Number(c._sum.tarjeta ?? 0));
    }

    const bancoPorDia = new Map<string, { importe: number; movimientos: number }>();
    for (const m of movimientos) {
      const dia = m.fecha.toISOString().slice(0, 10);
      const previo = bancoPorDia.get(dia) ?? { importe: 0, movimientos: 0 };
      bancoPorDia.set(dia, {
        importe: previo.importe + Number(m.importe),
        movimientos: previo.movimientos + 1,
      });
    }

    const filas = cuadreTarjeta({ declaradoPorDia, bancoPorDia, desfaseDias: desfase, umbral });

    return NextResponse.json({
      tienda: { id: tienda.id, nombre: tienda.nombre },
      desde: desdeStr,
      hasta: hastaStr,
      desfase,
      umbral,
      filas,
      // El extracto en crudo, para poder mirar un día concreto movimiento a
      // movimiento cuando la fila no cuadra.
      movimientos: movimientos.map((m) => ({
        id: m.id,
        fecha: m.fecha.toISOString().slice(0, 10),
        importe: Number(m.importe),
        concepto: m.concepto,
        referencia: m.referencia,
      })),
      totales: {
        declarado: Math.round(filas.reduce((n, f) => n + f.declarado, 0) * 100) / 100,
        banco: Math.round(filas.reduce((n, f) => n + f.banco, 0) * 100) / 100,
        descuadres: filas.filter((f) => f.descuadre).length,
      },
      // Sin extracto importado no hay nada que cuadrar: se dice, en vez de
      // enseñar todas las filas en rojo como si faltara el dinero.
      sinExtracto: movimientos.length === 0,
    });
  }),
);
