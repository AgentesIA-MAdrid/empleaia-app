import { auth } from "@/lib/auth";
import { prismaApp as prisma } from "@/lib/prisma";
import { Rol } from "@/generated/prisma-tenant/client";
import type { NextRequest } from "next/server";

import { withTenant } from "@/lib/tenant/with-tenant";
import { withFeature } from "@/lib/feature-guard/with-feature";
import { reconciliarTurnosOficina } from "@/lib/turnos/oficina-por-defecto";

/**
 * POST /api/turnos/oficina-por-defecto
 *
 * Reconcilia los turnos de "oficina por defecto" para las fechas indicadas
 * (los 7 días de la semana visible en el cuadrante). El cuadrante lo llama
 * al cargar cada semana y tras cada cambio de turnos: es idempotente.
 *
 * Body: { fechas: string[] }  // "yyyy-MM-dd"
 * Solo OWNER (crear/borrar turnos es gestión, igual que POST /api/turnos).
 */
export const POST = withTenant(
  withFeature("turnos_publicacion", async (request: NextRequest) => {
    try {
      const session = await auth();
      if (!session?.user) {
        return Response.json({ error: "No autorizado" }, { status: 401 });
      }

      const userRol = (session.user as { rol?: Rol }).rol;
      if (userRol !== Rol.OWNER) {
        return Response.json({ error: "No autorizado" }, { status: 403 });
      }

      const body = await request.json().catch(() => ({}));
      const fechas = Array.isArray(body?.fechas)
        ? (body.fechas as unknown[]).filter((f): f is string => typeof f === "string")
        : [];

      const resultado = await reconciliarTurnosOficina(prisma, fechas);
      return Response.json(resultado);
    } catch (error) {
      console.error("POST /api/turnos/oficina-por-defecto error:", error);
      return Response.json({ error: "Error interno del servidor" }, { status: 500 });
    }
  }),
);
