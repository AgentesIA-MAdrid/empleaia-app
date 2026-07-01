import { auth } from "@/lib/auth";
import { prismaApp as prisma } from "@/lib/prisma";
import { Rol, TipoFichaje } from "@/generated/prisma-tenant/client";
import type { NextRequest } from "next/server";

import { withTenant } from "@/lib/tenant/with-tenant";
export const PATCH = withTenant(async (request: NextRequest,
  { params }: { params: Promise<{ id: string }> }) => {
  try {
    const session = await auth();
    if (!session?.user) {
      return Response.json({ error: "No autorizado" }, { status: 401 });
    }

    // Edición administrativa de un fichaje: solo el Administrador (OWNER).
    // El Coordinador (MANAGER) tiene permisos de empleado; para corregir
    // sus propios fichajes usa el flujo de solicitudes de fichaje.
    const userRol = (session.user as any).rol as Rol;
    if (userRol !== Rol.OWNER) {
      return Response.json({ error: "No autorizado" }, { status: 403 });
    }

    const { id } = await params;

    const fichaje = await prisma.fichaje.findUnique({ where: { id } });
    if (!fichaje) {
      return Response.json({ error: "Fichaje no encontrado" }, { status: 404 });
    }

    const body = await request.json();
    const { tipo, timestamp, nota } = body as {
      tipo?: TipoFichaje;
      timestamp?: string;
      nota?: string;
    };

    const updated = await prisma.fichaje.update({
      where: { id },
      data: {
        ...(tipo && { tipo }),
        ...(timestamp && { timestamp: new Date(timestamp) }),
        ...(nota !== undefined && { nota }),
        editadoPor: session.user.id,
        editadoEn: new Date(),
      },
      include: {
        user: {
          select: { id: true, nombre: true, apellidos: true, email: true },
        },
        tienda: {
          select: { id: true, nombre: true },
        },
      },
    });

    return Response.json(updated);
  } catch (error) {
    console.error("PATCH /api/fichajes/[id] error:", error);
    return Response.json({ error: "Error interno del servidor" }, { status: 500 });
  }
});

export const DELETE = withTenant(async (_request: NextRequest,
  { params }: { params: Promise<{ id: string }> }) => {
  try {
    const session = await auth();
    if (!session?.user) {
      return Response.json({ error: "No autorizado" }, { status: 401 });
    }

    const userRol = (session.user as any).rol as Rol;
    if (userRol !== Rol.OWNER) {
      return Response.json({ error: "No autorizado" }, { status: 403 });
    }

    const { id } = await params;

    const fichaje = await prisma.fichaje.findUnique({ where: { id } });
    if (!fichaje) {
      return Response.json({ error: "Fichaje no encontrado" }, { status: 404 });
    }

    await prisma.fichaje.delete({ where: { id } });

    return Response.json({ message: "Fichaje eliminado correctamente" });
  } catch (error) {
    console.error("DELETE /api/fichajes/[id] error:", error);
    return Response.json({ error: "Error interno del servidor" }, { status: 500 });
  }
});
