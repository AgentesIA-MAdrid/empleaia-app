import { auth } from "@/lib/auth";
import { prismaApp as prisma } from "@/lib/prisma";
import { Rol, EstadoAusencia } from "@/generated/prisma-tenant/client";
import type { NextRequest } from "next/server";

import { withTenant } from "@/lib/tenant/with-tenant";
import { notifyAusenciaResuelta } from "@/lib/ausencias/notify";
export const PATCH = withTenant(async (request: NextRequest,
  { params }: { params: Promise<{ id: string }> }) => {
  try {
    const session = await auth();
    if (!session?.user) {
      return Response.json({ error: "No autorizado" }, { status: 401 });
    }

    const { id } = await params;
    const userRol = (session.user as any).rol as Rol;

    const ausencia = await prisma.ausencia.findUnique({
      where: { id },
      include: { user: { select: { tiendaId: true } } },
    });

    if (!ausencia) {
      return Response.json({ error: "Ausencia no encontrada" }, { status: 404 });
    }

    const body = await request.json();
    const { estado, comentarioAdmin } = body as {
      estado: EstadoAusencia;
      comentarioAdmin?: string;
    };

    if (!estado || !Object.values(EstadoAusencia).includes(estado)) {
      return Response.json({ error: "Estado inválido" }, { status: 400 });
    }

    // Coordinador (MANAGER) y Empleado comparten permisos de escritura:
    // solo pueden cancelar sus propias ausencias PENDIENTE. Aprobar/rechazar
    // queda reservado al Administrador (OWNER).
    if (userRol !== Rol.OWNER) {
      if (ausencia.userId !== session.user.id) {
        return Response.json({ error: "No autorizado" }, { status: 403 });
      }
      if (estado !== EstadoAusencia.CANCELADA) {
        return Response.json(
          { error: "Solo puedes cancelar tus propias ausencias pendientes" },
          { status: 403 }
        );
      }
      if (ausencia.estado !== EstadoAusencia.PENDIENTE) {
        return Response.json(
          { error: "Solo puedes cancelar ausencias en estado PENDIENTE" },
          { status: 400 }
        );
      }

      const updated = await prisma.ausencia.update({
        where: { id },
        data: { estado: EstadoAusencia.CANCELADA },
        include: {
          user: { select: { id: true, nombre: true, apellidos: true, email: true } },
          tipoAusencia: true,
        },
      });
      return Response.json(updated);
    }

    // A partir de aquí, userRol === OWNER (el resto retornó arriba).
    // Aprobar / rechazar / cambiar estado de cualquier ausencia.

    const updated = await prisma.ausencia.update({
      where: { id },
      data: {
        estado,
        ...(comentarioAdmin !== undefined && { comentarioAdmin }),
        ...(estado === EstadoAusencia.APROBADA || estado === EstadoAusencia.RECHAZADA
          ? {
              aprobadoPorId: session.user.id,
              aprobadoEn: new Date(),
            }
          : {}),
      },
      include: {
        user: { select: { id: true, nombre: true, apellidos: true, email: true, tiendaId: true } },
        tipoAusencia: true,
        aprobadoPor: { select: { id: true, nombre: true, apellidos: true } },
      },
    });

    // Best-effort: avisa al empleado del resultado (sólo APROBADA/RECHAZADA).
    void notifyAusenciaResuelta(updated);

    return Response.json(updated);
  } catch (error) {
    console.error("PATCH /api/ausencias/[id] error:", error);
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

    const ausencia = await prisma.ausencia.findUnique({ where: { id } });
    if (!ausencia) {
      return Response.json({ error: "Ausencia no encontrada" }, { status: 404 });
    }

    await prisma.ausencia.delete({ where: { id } });

    return Response.json({ message: "Ausencia eliminada correctamente" });
  } catch (error) {
    console.error("DELETE /api/ausencias/[id] error:", error);
    return Response.json({ error: "Error interno del servidor" }, { status: 500 });
  }
});
