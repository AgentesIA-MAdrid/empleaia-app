/**
 * GET /api/conciliacion/efectivo?tiendaId=&desde=&hasta= — el libro de caja de
 * una tienda (ticket 1e73c9a4).
 *
 * La conciliación decía "esta tienda no cuadra" y ahí se acababa. Esto es el
 * detalle: qué entró (el efectivo de cada cierre diario, con quién lo cerró),
 * qué salió (cada retirada, con la fecha y el responsable que firmó) y cuánto
 * quedaba en la caja después de cada movimiento.
 *
 * Los saldos de `FondoCaja` aparecen como apuntes que FIJAN el acumulado, no
 * como un ingreso: son un recuento real del cajón —el que cargó administración
 * al empezar, o el cero que deja cada arqueo declarado—.
 *
 * Solo administración: es el dinero de la empresa, tienda por tienda.
 */

import { auth } from "@/lib/auth";
import { prismaApp as prisma } from "@/lib/prisma";
import { NextResponse, type NextRequest } from "next/server";

import { withTenant } from "@/lib/tenant/with-tenant";
import { withFeature } from "@/lib/feature-guard/with-feature";
import { libroDeCaja } from "@/lib/cierre-turno/cuadre-diario";
import { rangoExclusivo } from "@/lib/cierre-turno/caja-queries";

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
    const desde = new Date(`${desdeStr}T00:00:00Z`);
    const hasta = new Date(`${hastaStr}T00:00:00Z`);
    if (hasta < desde) {
      return NextResponse.json({ error: "El rango está del revés." }, { status: 400 });
    }

    const tienda = await prisma.tienda.findUnique({
      where: { id: tiendaId },
      select: { id: true, nombre: true, sinEfectivo: true, esOficina: true },
    });
    if (!tienda) return NextResponse.json({ error: "Esa tienda no existe." }, { status: 404 });

    const [cajas, arqueos, saldos] = await Promise.all([
      prisma.cierreCaja.findMany({
        where: {
          tiendaId,
          fecha: rangoExclusivo(desde, hasta),
          confirmadoEn: { not: null },
          // Un cierre sin efectivo no es un apunte: ensuciaría el libro.
          efectivo: { gt: 0 },
        },
        select: {
          id: true,
          fecha: true,
          efectivo: true,
          cierre: {
            select: { id: true, user: { select: { nombre: true, apellidos: true } } },
          },
        },
        orderBy: { fecha: "asc" },
      }),
      // Las retiradas se sitúan el día en que se FIRMAN, no el del periodo
      // arqueado: es cuando el dinero sale físicamente del cajón.
      prisma.arqueo.findMany({
        where: {
          tiendaId,
          estado: "recogido",
          recogidoEn: { gte: desde, lt: new Date(hasta.getTime() + 86_400_000) },
        },
        select: {
          id: true,
          semana: true,
          recogidoEn: true,
          efectivoDeclarado: true,
          efectivoRecogido: true,
          recogidoPor: { select: { nombre: true, apellidos: true } },
        },
      }),
      prisma.fondoCaja.findMany({
        where: { tiendaId, fecha: { gte: desde, lte: hasta } },
        select: { fecha: true, importe: true, incidencia: true, nota: true },
      }),
    ]);

    const { movimientos, saldoFinal } = libroDeCaja({
      saldos: saldos.map((f) => ({
        fecha: f.fecha.toISOString().slice(0, 10),
        importe: f.importe === null ? null : Number(f.importe),
        nota: f.nota ?? f.incidencia,
      })),
      entradas: cajas.map((c) => ({
        fecha: c.fecha.toISOString().slice(0, 10),
        importe: Number(c.efectivo),
        quien: c.cierre?.user
          ? `${c.cierre.user.nombre} ${c.cierre.user.apellidos}`.trim()
          : null,
        cierreId: c.cierre?.id ?? null,
      })),
      salidas: arqueos.map((a) => ({
        fecha: (a.recogidoEn ?? desde).toISOString().slice(0, 10),
        importe:
          a.efectivoRecogido === null ? Number(a.efectivoDeclarado) : Number(a.efectivoRecogido),
        quien: a.recogidoPor ? `${a.recogidoPor.nombre} ${a.recogidoPor.apellidos}`.trim() : null,
        semana: a.semana,
        arqueoId: a.id,
      })),
    });

    const entradas = movimientos
      .filter((m) => m.tipo === "entrada")
      .reduce((n, m) => n + m.importe, 0);
    const salidas = movimientos
      .filter((m) => m.tipo === "salida")
      .reduce((n, m) => n + m.importe, 0);

    return NextResponse.json({
      tienda: { id: tienda.id, nombre: tienda.nombre },
      desde: desdeStr,
      hasta: hastaStr,
      sinCaja: tienda.sinEfectivo || tienda.esOficina,
      movimientos,
      totales: {
        entradas: Math.round(entradas * 100) / 100,
        salidas: Math.round(salidas * 100) / 100,
        saldoFinal,
      },
    });
  }),
);
