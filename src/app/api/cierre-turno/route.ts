/**
 * GET  /api/cierre-turno — cierres visibles según el rol.
 *   ?fecha=YYYY-MM-DD   día concreto (por defecto, hoy)
 *   ?tiendaId=…         filtro de sede (OWNER; el MANAGER va atado a la suya)
 *
 * El alcance no lo elige el cliente: sale del rol (ver `alcanceSegunRol`).
 * Un comercial solo ve sus cierres aunque pida otra sede.
 *
 * Entrega 1 (esqueleto): lectura. El guardado del asistente y el cierre de
 * caja llegan en la entrega 2.
 */

import { auth } from "@/lib/auth";
import { prismaApp as prisma } from "@/lib/prisma";
import { NextResponse, type NextRequest } from "next/server";

import { withTenant } from "@/lib/tenant/with-tenant";
import { withFeature } from "@/lib/feature-guard/with-feature";
import { alcanceSegunRol } from "@/lib/cierre-turno/core";

const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;

export const GET = withTenant(
  withFeature("cierre_turno", async (req: NextRequest) => {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
    const userId = session.user.id!;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rol = (session.user as any).rol as string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tiendaPropia = (session.user as any).tiendaId as string | null;

    const url = new URL(req.url);
    const fechaParam = url.searchParams.get("fecha");
    if (fechaParam && !FECHA_RE.test(fechaParam)) {
      return NextResponse.json({ error: "Fecha no válida" }, { status: 400 });
    }
    const fecha = new Date(`${fechaParam ?? new Date().toISOString().slice(0, 10)}T00:00:00Z`);

    const alcance = alcanceSegunRol(rol);
    const tiendaFiltro = url.searchParams.get("tiendaId");

    const where =
      alcance === "propio"
        ? { userId, fecha }
        : alcance === "sede"
          ? { fecha, tiendaId: tiendaPropia }
          : { fecha, ...(tiendaFiltro ? { tiendaId: tiendaFiltro } : {}) };

    const cierres = await prisma.cierreTurno.findMany({
      where,
      select: {
        id: true,
        fecha: true,
        estado: true,
        incidencia: true,
        completadoEn: true,
        user: { select: { id: true, nombre: true, apellidos: true } },
        tienda: { select: { id: true, nombre: true } },
        caja: { select: { efectivo: true, tarjeta: true, confirmadoEn: true } },
        _count: { select: { ventas: true } },
      },
      orderBy: [{ tiendaId: "asc" }, { userId: "asc" }],
    });

    return NextResponse.json({
      alcance,
      fecha: fecha.toISOString().slice(0, 10),
      cierres: cierres.map((c) => ({
        id: c.id,
        estado: c.estado,
        tieneIncidencia: Boolean(c.incidencia),
        completado: Boolean(c.completadoEn),
        empleado: `${c.user.nombre} ${c.user.apellidos}`.trim(),
        empleadoId: c.user.id,
        sede: c.tienda?.nombre ?? null,
        articulosVendidos: c._count.ventas,
        caja: c.caja
          ? {
              efectivo: Number(c.caja.efectivo),
              tarjeta: Number(c.caja.tarjeta),
              confirmado: Boolean(c.caja.confirmadoEn),
            }
          : null,
      })),
    });
  }),
);
