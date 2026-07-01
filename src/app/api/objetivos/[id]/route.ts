/**
 * PUT /api/objetivos/[id] — actualiza progreso/estado/datos. OWNER y
 * MANAGER pueden editar cualquier campo. EMPLEADO solo `progreso` de
 * objetivos asignados a sí mismo.
 *
 * DELETE /api/objetivos/[id] — OWNER o MANAGER. EMPLEADO no puede.
 *
 * Feature: `objetivos`.
 */

import { auth } from "@/lib/auth";
import { prismaApp as prisma } from "@/lib/prisma";
import { Rol } from "@/generated/prisma-tenant/client";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { withTenant } from "@/lib/tenant/with-tenant";
import { withFeature } from "@/lib/feature-guard/with-feature";

const updateSchema = z.object({
  titulo: z.string().min(1).max(200).optional(),
  descripcion: z.string().max(2000).nullable().optional(),
  asignadoAId: z.string().nullable().optional(),
  periodo: z.string().min(1).max(50).optional(),
  estado: z.enum(["activo", "completado", "cancelado"]).optional(),
  progreso: z.number().int().min(0).max(100).optional(),
  fechaCierre: z.string().datetime().nullable().optional(),
});

export const PUT = withTenant(withFeature("objetivos", async (
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) => {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    const userId = session.user.id!;
    const userRol = (session.user as { rol?: Rol }).rol;

    const { id } = await params;
    const obj = await prisma.objetivo.findUnique({
      where: { id },
      select: { asignadoAId: true },
    });
    if (!obj) return NextResponse.json({ error: "Objetivo no encontrado" }, { status: 404 });

    let body: unknown;
    try { body = await req.json(); } catch { return NextResponse.json({ error: "Body inválido" }, { status: 400 }); }
    const parsed = updateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Datos inválidos", details: parsed.error.flatten() }, { status: 400 });
    }

    // Gestión = Administrador (OWNER). El Coordinador (MANAGER) actúa como
    // empleado: solo puede tocar `progreso` de objetivos asignados a sí mismo.
    const esAdmin = userRol === Rol.OWNER;
    const esAsignado = obj.asignadoAId === userId;

    if (!esAdmin) {
      // EMPLEADO: solo puede tocar `progreso` y sólo si está asignado.
      const keys = Object.keys(parsed.data);
      const soloProgreso = keys.length === 1 && keys[0] === "progreso";
      if (!esAsignado || !soloProgreso) {
        return NextResponse.json({ error: "No autorizado" }, { status: 403 });
      }
    }

    const data: Record<string, unknown> = {};
    if (parsed.data.titulo !== undefined) data.titulo = parsed.data.titulo;
    if (parsed.data.descripcion !== undefined) data.descripcion = parsed.data.descripcion;
    if (parsed.data.asignadoAId !== undefined) data.asignadoAId = parsed.data.asignadoAId;
    if (parsed.data.periodo !== undefined) data.periodo = parsed.data.periodo;
    if (parsed.data.estado !== undefined) data.estado = parsed.data.estado;
    if (parsed.data.progreso !== undefined) data.progreso = parsed.data.progreso;
    if (parsed.data.fechaCierre !== undefined) {
      data.fechaCierre = parsed.data.fechaCierre ? new Date(parsed.data.fechaCierre) : null;
    }

    const objetivo = await prisma.objetivo.update({
      where: { id },
      data,
      include: {
        asignadoA: { select: { id: true, nombre: true, apellidos: true, foto: true } },
        creadoPor: { select: { id: true, nombre: true, apellidos: true } },
      },
    });

    return NextResponse.json({ objetivo });
  } catch (error) {
    console.error("PUT /api/objetivos/[id] error:", error);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}));

export const DELETE = withTenant(withFeature("objetivos", async (
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) => {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    const userRol = (session.user as { rol?: Rol }).rol;
    if (userRol !== Rol.OWNER) {
      return NextResponse.json({ error: "Solo el Administrador puede borrar objetivos" }, { status: 403 });
    }

    const { id } = await params;
    await prisma.objetivo.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("DELETE /api/objetivos/[id] error:", error);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}));
