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
import { sedesDelUsuario } from "@/lib/tiendas/sedes-usuario";
import { filtroSede } from "@/lib/cierre-turno/core";
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

    // El alcance sale de las sedes reales de la persona, no de su sede
    // principal: un coordinador lleva varias (ticket 73) y puede no tener
    // principal. Antes se pasaba `session.user.tiendaId` a pelo y un
    // coordinador sin sede acababa viendo las horas de toda la cadena,
    // porque `...(tiendaId ? …)` borra el filtro con null. `filtroSede`
    // distingue "todas" de "ninguna", que es justo lo que faltaba.
    const sesionUser = session.user as { id?: string; tiendaId?: string | null };
    const sedesPropias =
      userRol === Rol.MANAGER && sesionUser.id
        ? await sedesDelUsuario(prisma, {
            userId: sesionUser.id,
            tiendaId: sesionUser.tiendaId ?? null,
          })
        : [];
    const filtro = filtroSede(userRol, sedesPropias, searchParams.get("tiendaId"));
    // Sin sedes no hay nada que enseñar — que no es lo mismo que enseñarlo todo.
    if (filtro.tipo === "ninguna") return Response.json({ filas: [], origen });
    const tiendaIds = filtro.tipo === "sedes" ? filtro.tiendaIds : null;

    const filas =
      origen === "cuadrante"
        ? await calcularHorasPorCentroCuadrante({ prisma, fechaInicio, fechaFin, tiendaIds })
        : await calcularHorasPorCentro({ prisma, fechaInicio, fechaFin, tiendaIds });
    return Response.json({ filas, origen });
  } catch (error) {
    console.error("GET /api/informes/horas-por-centro error:", error);
    return Response.json({ error: "Error interno del servidor" }, { status: 500 });
  }
});
