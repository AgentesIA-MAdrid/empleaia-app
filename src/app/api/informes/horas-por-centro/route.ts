/**
 * GET /api/informes/horas-por-centro?fechaInicio&fechaFin&tiendaId&origen
 *
 * Horas por empleado y centro en el periodo. OWNER ve todas las sedes;
 * MANAGER solo la suya. Lógica de agregación en
 * `@/lib/informes/horas-por-centro` (pura, testeada).
 *
 * `origen` (default `fichajes`, se mantiene por compatibilidad):
 *  - `fichajes`  → horas realmente fichadas.
 *  - `cuadrante` → horas planificadas en los turnos del cuadrante. Requiere
 *    la feature `turnos_publicacion` (es el módulo de Turnos el que aporta
 *    el dato), igual que el export del cuadrante.
 *
 * Cada fila lleva además `horasTotales` (del empleado en todas sus sedes),
 * `horasContrato` (su contrato semanal prorrateado al periodo) y
 * `diferencia`, para poder calcular horas extra.
 */

import { auth } from "@/lib/auth";
import { prismaApp as prisma } from "@/lib/prisma";
import { Rol } from "@/generated/prisma-tenant/client";
import type { NextRequest } from "next/server";
import { withTenant } from "@/lib/tenant/with-tenant";
import { hasFeature } from "@/lib/tenant/features";
import {
  calcularHorasPorCentro,
  calcularHorasPorCentroCuadrante,
  ORIGENES_HORAS_CENTRO,
  type OrigenHorasCentro,
} from "@/lib/informes/horas-por-centro";

export const GET = withTenant(async (request: NextRequest) => {
  try {
    const session = await auth();
    if (!session?.user) return Response.json({ error: "No autorizado" }, { status: 401 });
    const userRol = (session.user as { rol?: Rol }).rol;
    if (userRol !== Rol.OWNER && userRol !== Rol.MANAGER) {
      return Response.json({ error: "No autorizado" }, { status: 403 });
    }

    const { searchParams } = request.nextUrl;
    const origen = (searchParams.get("origen") ?? "fichajes") as OrigenHorasCentro;
    if (!ORIGENES_HORAS_CENTRO.includes(origen)) {
      return Response.json(
        { error: "origen_invalido", allowed: ORIGENES_HORAS_CENTRO },
        { status: 400 },
      );
    }
    if (origen === "cuadrante" && !hasFeature("turnos_publicacion")) {
      return Response.json(
        {
          error: "feature_required",
          feature_key: "turnos_publicacion",
          upgrade_url: "/admin/planes?upgrade=turnos_publicacion",
        },
        { status: 402 },
      );
    }

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

    const filas =
      origen === "cuadrante"
        ? await calcularHorasPorCentroCuadrante({ prisma, fechaInicio, fechaFin, tiendaId })
        : await calcularHorasPorCentro({ prisma, fechaInicio, fechaFin, tiendaId });
    return Response.json({ filas, origen });
  } catch (error) {
    console.error("GET /api/informes/horas-por-centro error:", error);
    return Response.json({ error: "Error interno del servidor" }, { status: 500 });
  }
});
