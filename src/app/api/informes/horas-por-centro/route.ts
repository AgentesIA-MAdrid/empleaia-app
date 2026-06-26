/**
 * GET /api/informes/horas-por-centro?fechaInicio&fechaFin
 *
 * Horas trabajadas por empleado y centro en el periodo. OWNER ve todas las
 * sedes; MANAGER solo la suya. Lógica de agregación en
 * `@/lib/informes/horas-por-centro` (pura, testeada).
 */

import { auth } from "@/lib/auth";
import { prismaApp as prisma } from "@/lib/prisma";
import { Rol } from "@/generated/prisma-tenant/client";
import type { NextRequest } from "next/server";
import { withTenant } from "@/lib/tenant/with-tenant";
import { calcularHorasPorCentro } from "@/lib/informes/horas-por-centro";

export const GET = withTenant(async (request: NextRequest) => {
  try {
    const session = await auth();
    if (!session?.user) return Response.json({ error: "No autorizado" }, { status: 401 });
    const userRol = (session.user as { rol?: Rol }).rol;
    if (userRol !== Rol.OWNER && userRol !== Rol.MANAGER) {
      return Response.json({ error: "No autorizado" }, { status: 403 });
    }

    const { searchParams } = request.nextUrl;
    const fi = searchParams.get("fechaInicio");
    const ff = searchParams.get("fechaFin");
    if (!fi || !ff) {
      return Response.json({ error: "Faltan fechaInicio y fechaFin" }, { status: 400 });
    }
    const fechaInicio = new Date(fi);
    const fechaFin = new Date(ff);
    if (Number.isNaN(fechaInicio.getTime()) || Number.isNaN(fechaFin.getTime())) {
      return Response.json({ error: "Fechas inválidas" }, { status: 400 });
    }
    // Incluir todo el día final.
    fechaFin.setHours(23, 59, 59, 999);

    const tiendaId =
      userRol === Rol.MANAGER
        ? ((session.user as { tiendaId?: string | null }).tiendaId ?? null)
        : (searchParams.get("tiendaId") || null);

    const filas = await calcularHorasPorCentro({ prisma, fechaInicio, fechaFin, tiendaId });
    return Response.json({ filas });
  } catch (error) {
    console.error("GET /api/informes/horas-por-centro error:", error);
    return Response.json({ error: "Error interno del servidor" }, { status: 500 });
  }
});
