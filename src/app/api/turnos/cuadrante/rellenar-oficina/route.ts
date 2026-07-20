import { auth } from "@/lib/auth";
import { prismaApp as prisma } from "@/lib/prisma";
import { Rol } from "@/generated/prisma-tenant/client";
import type { NextRequest } from "next/server";

import { withTenant } from "@/lib/tenant/with-tenant";
import { withFeature } from "@/lib/feature-guard/with-feature";
import { rellenarOficina } from "@/lib/turnos/rellenar-oficina";

// Rellena los días laborables sin turno de los empleados marcados con
// "horario de oficina automático" (User.autoTurnoOficina) con un turno de
// 09:00–17:00 en la sede "Oficina". Lo invoca el cuadrante al publicar.
export const POST = withTenant(
  withFeature("turnos_publicacion", async (request: NextRequest) => {
    try {
      const session = await auth();
      if (!session?.user) {
        return Response.json({ error: "No autorizado" }, { status: 401 });
      }

      // Igual que crear turnos: es gestión, solo el Administrador (OWNER).
      const userRol = (session.user as any).rol as Rol; // eslint-disable-line @typescript-eslint/no-explicit-any
      if (userRol !== Rol.OWNER) {
        return Response.json({ error: "No autorizado" }, { status: 403 });
      }

      const body = await request.json().catch(() => ({}));
      const dias: string[] = Array.isArray(body?.dias)
        ? body.dias.filter(
            (d: unknown): d is string =>
              typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d),
          )
        : [];
      if (dias.length === 0) {
        return Response.json(
          { error: "Faltan los días de la semana (dias: string[] en formato YYYY-MM-DD)" },
          { status: 400 },
        );
      }

      const resultado = await rellenarOficina(prisma, dias);
      return Response.json(resultado);
    } catch (error) {
      console.error("POST /api/turnos/cuadrante/rellenar-oficina error:", error);
      return Response.json({ error: "Error interno del servidor" }, { status: 500 });
    }
  }),
);
