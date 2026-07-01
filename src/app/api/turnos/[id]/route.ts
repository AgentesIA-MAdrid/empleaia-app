import { auth } from "@/lib/auth";
import { prismaApp as prisma } from "@/lib/prisma";
import { Rol, EstadoTurno } from "@/generated/prisma-tenant/client";
import type { NextRequest } from "next/server";

import { withTenant } from "@/lib/tenant/with-tenant";
export const PUT = withTenant(async (request: NextRequest,
  { params }: { params: Promise<{ id: string }> }) => {
  try {
    const session = await auth();
    if (!session?.user) {
      return Response.json({ error: "No autorizado" }, { status: 401 });
    }

    // Editar/borrar turnos es gestión: solo el Administrador (OWNER).
    const userRol = (session.user as any).rol as Rol;
    if (userRol !== Rol.OWNER) {
      return Response.json({ error: "No autorizado" }, { status: 403 });
    }

    const { id } = await params;

    const turno = await prisma.turno.findUnique({ where: { id } });
    if (!turno) {
      return Response.json({ error: "Turno no encontrado" }, { status: 404 });
    }

    const body = await request.json();
    const { userId, tiendaId, tipoTurnoId, fecha, horaInicio, horaFin, nota, estado } = body as {
      userId?: string;
      tiendaId?: string;
      tipoTurnoId?: string | null;
      fecha?: string;
      horaInicio?: string;
      horaFin?: string;
      nota?: string;
      estado?: EstadoTurno;
    };

    const updated = await prisma.turno.update({
      where: { id },
      data: {
        ...(userId && { userId }),
        ...(tiendaId && { tiendaId }),
        ...(tipoTurnoId !== undefined && { tipoTurnoId }),
        ...(fecha && { fecha: new Date(fecha) }),
        ...(horaInicio && { horaInicio }),
        ...(horaFin && { horaFin }),
        ...(nota !== undefined && { nota }),
        ...(estado && { estado }),
      },
      include: {
        user: {
          select: { id: true, nombre: true, apellidos: true, email: true },
        },
        tienda: {
          select: { id: true, nombre: true, color: true },
        },
        tipoTurno: {
          select: {
            id: true,
            nombre: true,
            abreviatura: true,
            color: true,
            horas: true,
            esLibre: true,
          },
        },
      },
    });

    return Response.json(updated);
  } catch (error) {
    console.error("PUT /api/turnos/[id] error:", error);
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

    // Editar/borrar turnos es gestión: solo el Administrador (OWNER).
    const userRol = (session.user as any).rol as Rol;
    if (userRol !== Rol.OWNER) {
      return Response.json({ error: "No autorizado" }, { status: 403 });
    }

    const { id } = await params;

    const turno = await prisma.turno.findUnique({ where: { id } });
    if (!turno) {
      return Response.json({ error: "Turno no encontrado" }, { status: 404 });
    }

    await prisma.turno.delete({ where: { id } });

    return Response.json({ message: "Turno eliminado correctamente" });
  } catch (error) {
    console.error("DELETE /api/turnos/[id] error:", error);
    return Response.json({ error: "Error interno del servidor" }, { status: 500 });
  }
});
