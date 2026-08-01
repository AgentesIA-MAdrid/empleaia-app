/**
 * GET /api/conciliacion/facturacion?tiendaId=&desde=&hasta=&desfase= — lo que la
 * tienda declara haber cobrado frente a lo que consta facturado en el sistema
 * del operador, día a día (ticket 4b8e1d05).
 *
 * Es la tercera pata del cuadre. Las otras dos comprueban que el dinero está;
 * esta comprueba que la venta **se tramitó**: una venta declarada que nadie metió
 * a facturar no aparece en el otro sistema, y un importe facturado sin venta
 * declarada tampoco cuadra.
 *
 * Se compara lo cobrado en el cierre (efectivo + tarjeta) contra el importe
 * facturado. Por defecto, del MISMO día: a diferencia del banco, aquí no hay
 * liquidación de por medio. Con `?desfase=` se puede desplazar si el operador
 * fecha las altas al día siguiente.
 *
 * Los importes salen de `MovimientoFacturacion`, que se importa del Excel del
 * operador (ver `/api/movimientos-facturacion`).
 *
 * Solo administración.
 */

import { auth } from "@/lib/auth";
import { prismaApp as prisma } from "@/lib/prisma";
import { NextResponse, type NextRequest } from "next/server";

import { withTenant } from "@/lib/tenant/with-tenant";
import { withFeature } from "@/lib/feature-guard/with-feature";
import { cuadrePorDia, sumarDias } from "@/lib/cierre-turno/cuadre-diario";
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
    // Aquí el defecto es 0 —mismo día—: la venta se factura cuando se hace, sin
    // la liquidación de por medio que sí desplaza los cobros con tarjeta.
    const desfaseCrudo = url.searchParams.get("desfase");
    const desfasePedido = desfaseCrudo === null ? NaN : Number(desfaseCrudo);
    const desfase =
      Number.isInteger(desfasePedido) && desfasePedido >= 0 && desfasePedido <= 7
        ? desfasePedido
        : 0;

    const desde = new Date(`${desdeStr}T00:00:00Z`);
    const hasta = new Date(`${hastaStr}T00:00:00Z`);
    if (hasta < desde) {
      return NextResponse.json({ error: "El rango está del revés." }, { status: 400 });
    }
    // Si el operador fecha con desfase, el rango de su fichero se desplaza igual
    // que el del banco.
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
        // Lo cobrado, sin distinguir medio de pago: al operador se le factura la
        // venta entera.
        _sum: { efectivo: true, tarjeta: true },
      }),
      prisma.movimientoFacturacion.findMany({
        where: { tiendaId, fecha: rangoExclusivo(desdeBanco, hastaBanco) },
        select: { id: true, fecha: true, importe: true, concepto: true, referencia: true },
        orderBy: { fecha: "asc" },
      }),
      umbralDescuadre(prisma),
    ]);

    const declaradoPorDia = new Map<string, number>();
    for (const c of cajas) {
      declaradoPorDia.set(
        c.fecha.toISOString().slice(0, 10),
        Number(c._sum.efectivo ?? 0) + Number(c._sum.tarjeta ?? 0),
      );
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

    const filas = cuadrePorDia({ declaradoPorDia, bancoPorDia, desfaseDias: desfase, umbral });

    return NextResponse.json({
      tienda: { id: tienda.id, nombre: tienda.nombre },
      desde: desdeStr,
      hasta: hastaStr,
      desfase,
      umbral,
      filas,
      // El fichero en crudo, para poder mirar un día concreto línea a línea
      // cuando la fila no cuadra.
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
      // Sin fichero importado no hay nada que cuadrar: se dice, en vez de
      // enseñar todas las filas en rojo como si no se hubiera facturado nada.
      sinExtracto: movimientos.length === 0,
    });
  }),
);
