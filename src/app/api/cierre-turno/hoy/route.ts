/**
 * GET /api/cierre-turno/hoy — el cierre de hoy del propio comercial, con lo que
 * ya tenga guardado. Sirve para que el asistente recupere el borrador si cierra
 * el móvil a media faena, en vez de empezar de cero.
 */

import { auth } from "@/lib/auth";
import { prismaApp as prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

import { withTenant } from "@/lib/tenant/with-tenant";
import { withFeature } from "@/lib/feature-guard/with-feature";
import { diaMadrid, pasosPendientes } from "@/lib/cierre-turno/core";

export const GET = withTenant(
  withFeature("cierre_turno", async () => {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
    const userId = session.user.id!;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tiendaId = ((session.user as any).tiendaId as string | null) ?? null;
    const dia = diaMadrid();
    const fecha = new Date(`${dia}T00:00:00Z`);

    // Si su sede es de las que venden sin que el dinero sea nuestro (un córner
    // que liquida el tercero), el paso de caja no pide importes: pide el stock y
    // los tickets de las ventas facturadas (ticket 9d4e17c2).
    const sede = tiendaId
      ? await prisma.tienda.findUnique({
          where: { id: tiendaId },
          select: { nombre: true, sinEfectivo: true },
        })
      : null;
    const sedeSinEfectivo = sede?.sinEfectivo === true;

    const cierre = await prisma.cierreTurno.findUnique({
      where: { userId_fecha: { userId, fecha } },
      select: {
        id: true,
        detalleJornada: true,
        incidencia: true,
        completadoEn: true,
        ventas: { select: { articuloId: true, cantidad: true } },
        caja: { select: { id: true, efectivo: true, tarjeta: true, confirmadoEn: true } },
      },
    });

    if (!cierre) {
      return NextResponse.json({
        dia,
        existe: false,
        sedeSinEfectivo,
        sedeNombre: sede?.nombre ?? null,
        pendientes: ["ventas", "caja", "incidencias"],
      });
    }

    return NextResponse.json({
      dia,
      existe: true,
      sedeSinEfectivo,
      sedeNombre: sede?.nombre ?? null,
      cerrado: Boolean(cierre.completadoEn),
      detalleJornada: cierre.detalleJornada ?? "",
      incidencia: cierre.incidencia,
      ventas: cierre.ventas
        .filter((v) => v.articuloId)
        .map((v) => ({ articuloId: v.articuloId as string, cantidad: v.cantidad })),
      caja: cierre.caja
        ? {
            efectivo: Number(cierre.caja.efectivo),
            tarjeta: Number(cierre.caja.tarjeta),
            confirmado: Boolean(cierre.caja.confirmadoEn),
          }
        : null,
      pendientes: pasosPendientes({
        ventas: cierre.ventas.length,
        detalleJornada: cierre.detalleJornada,
        cajaConfirmada: Boolean(cierre.caja?.confirmadoEn),
        completadoEn: cierre.completadoEn,
      }),
    });
  }),
);
