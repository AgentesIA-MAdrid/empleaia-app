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
    const dia = diaMadrid();
    const fecha = new Date(`${dia}T00:00:00Z`);

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
      return NextResponse.json({ dia, existe: false, pendientes: ["ventas", "caja", "incidencias"] });
    }

    return NextResponse.json({
      dia,
      existe: true,
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
