import { auth } from "@/lib/auth";
import { prismaApp as prisma } from "@/lib/prisma";
import { Rol } from "@/generated/prisma-tenant/client";
import { NextRequest, NextResponse } from "next/server";

import { withTenant } from "@/lib/tenant/with-tenant";
import { withFeature } from "@/lib/feature-guard/with-feature";
export const PUT = withTenant(withFeature("tareas", async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    const userId = session.user.id!;
    const userRol = (session.user as { rol?: Rol }).rol;

    const { id } = await params;
    const body = await req.json();

    const tarea = await prisma.tarea.findUnique({
      where: { id },
      select: { creadoPorId: true, asignadoAId: true },
    });
    if (!tarea) return NextResponse.json({ error: "Tarea no encontrada" }, { status: 404 });

    // Gestión = Administrador (OWNER). El Coordinador (MANAGER) actúa como
    // empleado (creador o asignado que solo marca completada).
    const esAdmin = userRol === Rol.OWNER;
    const esCreador = tarea.creadoPorId === userId;
    const esAsignado = tarea.asignadoAId === userId;

    // Asignado solo puede cambiar el estado de completada — nada más.
    const camposNoEstado = Object.keys(body).filter((k) => k !== "completada");
    const soloMarcaCompletada = camposNoEstado.length === 0 && body.completada !== undefined;

    const puedeEditar = esAdmin || esCreador || (esAsignado && soloMarcaCompletada);
    if (!puedeEditar) {
      return NextResponse.json({ error: "No autorizado" }, { status: 403 });
    }

    const tareaActualizada = await prisma.tarea.update({
      where: { id },
      data: {
        ...(body.titulo !== undefined && { titulo: body.titulo }),
        ...(body.descripcion !== undefined && { descripcion: body.descripcion }),
        ...(body.prioridad !== undefined && { prioridad: body.prioridad }),
        ...(body.completada !== undefined && { completada: body.completada }),
        ...(body.fechaLimite !== undefined && { fechaLimite: body.fechaLimite ? new Date(body.fechaLimite) : null }),
        ...(body.asignadoAId !== undefined && { asignadoAId: body.asignadoAId || null }),
      },
      include: {
        asignadoA: { select: { id: true, nombre: true, apellidos: true } },
        creadoPor: { select: { id: true, nombre: true, apellidos: true } },
      },
    });

    return NextResponse.json({ tarea: tareaActualizada });
  } catch (error) {
    console.error("PUT /api/tareas/[id] error:", error);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}));

export const DELETE = withTenant(withFeature("tareas", async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    const userId = session.user.id!;
    const userRol = (session.user as { rol?: Rol }).rol;

    const { id } = await params;

    const tarea = await prisma.tarea.findUnique({
      where: { id },
      select: { creadoPorId: true },
    });
    if (!tarea) return NextResponse.json({ error: "Tarea no encontrada" }, { status: 404 });

    const puedeBorrar = userRol === Rol.OWNER || tarea.creadoPorId === userId;
    if (!puedeBorrar) {
      return NextResponse.json({ error: "No autorizado" }, { status: 403 });
    }

    await prisma.tarea.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("DELETE /api/tareas/[id] error:", error);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}));
