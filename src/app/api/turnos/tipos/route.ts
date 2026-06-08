/**
 * GET/POST /api/turnos/tipos — catálogo de tipos de turno del cliente.
 *
 * Análogo a /api/ausencias/tipos. GET lista los activos (cualquier
 * sesión, para poder elegir turno al planificar). POST crea (solo OWNER).
 */

import { auth } from "@/lib/auth";
import { prismaApp as prisma } from "@/lib/prisma";
import { Rol } from "@/generated/prisma-tenant/client";
import type { NextRequest } from "next/server";

import { withTenant } from "@/lib/tenant/with-tenant";
import { withFeature } from "@/lib/feature-guard/with-feature";

export const GET = withTenant(
  withFeature("turnos_publicacion", async () => {
    try {
      const session = await auth();
      if (!session?.user) {
        return Response.json({ error: "No autorizado" }, { status: 401 });
      }

      const tipos = await prisma.tipoTurno.findMany({
        where: { activo: true },
        orderBy: [{ orden: "asc" }, { nombre: "asc" }],
      });

      return Response.json(tipos);
    } catch (error) {
      console.error("GET /api/turnos/tipos error:", error);
      return Response.json({ error: "Error interno del servidor" }, { status: 500 });
    }
  }),
);

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

      const body = (await request.json()) as {
        nombre: string;
        abreviatura?: string;
        color?: string;
        horaInicio?: string | null;
        horaFin?: string | null;
        horas?: number;
        esLibre?: boolean;
        orden?: number;
      };

      if (!body.nombre) {
        return Response.json({ error: "El nombre es obligatorio" }, { status: 400 });
      }

      const tipo = await prisma.tipoTurno.create({
        data: {
          nombre: body.nombre,
          abreviatura: body.abreviatura ?? "",
          color: body.color ?? "#6366f1",
          horaInicio: body.horaInicio ?? null,
          horaFin: body.horaFin ?? null,
          horas: body.horas ?? 0,
          esLibre: body.esLibre ?? false,
          orden: body.orden ?? 0,
        },
      });

      return Response.json(tipo, { status: 201 });
    } catch (error) {
      console.error("POST /api/turnos/tipos error:", error);
      return Response.json({ error: "Error interno del servidor" }, { status: 500 });
    }
  }),
);
