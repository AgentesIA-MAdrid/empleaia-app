/**
 * GET /api/objetivos — lista objetivos del tenant.
 *   - OWNER/MANAGER ven todos.
 *   - EMPLEADO ve los suyos (asignadoAId=session.user.id) + los de
 *     empresa (asignadoAId=null).
 *
 * POST /api/objetivos — crea un objetivo. OWNER/MANAGER.
 *
 * Feature: `objetivos` (plan pro+).
 */

import { auth } from "@/lib/auth";
import { prismaApp as prisma } from "@/lib/prisma";
import { Rol } from "@/generated/prisma-tenant/client";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { withTenant } from "@/lib/tenant/with-tenant";
import { withFeature } from "@/lib/feature-guard/with-feature";

const ESTADOS = ["activo", "completado", "cancelado"] as const;
const createSchema = z.object({
  titulo: z.string().min(1).max(200),
  descripcion: z.string().max(2000).optional().nullable(),
  asignadoAId: z.string().nullable().optional(),
  periodo: z.string().min(1).max(50),
  progreso: z.number().int().min(0).max(100).optional(),
});

export const GET = withTenant(withFeature("objetivos", async () => {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    const userId = session.user.id!;
    const userRol = (session.user as { rol?: Rol }).rol;

    const where =
      userRol === Rol.OWNER || userRol === Rol.MANAGER
        ? {}
        : { OR: [{ asignadoAId: userId }, { asignadoAId: null }] };

    const objetivos = await prisma.objetivo.findMany({
      where,
      include: {
        asignadoA: { select: { id: true, nombre: true, apellidos: true, foto: true } },
        creadoPor: { select: { id: true, nombre: true, apellidos: true } },
      },
      orderBy: [{ estado: "asc" }, { createdAt: "desc" }],
    });

    return NextResponse.json({ objetivos });
  } catch (error) {
    console.error("GET /api/objetivos error:", error);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}));

export const POST = withTenant(withFeature("objetivos", async (req: NextRequest) => {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    const userId = session.user.id!;
    const userRol = (session.user as { rol?: Rol }).rol;

    if (userRol !== Rol.OWNER) {
      return NextResponse.json({ error: "Solo el Administrador puede crear objetivos" }, { status: 403 });
    }

    let body: unknown;
    try { body = await req.json(); } catch { return NextResponse.json({ error: "Body inválido" }, { status: 400 }); }
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Datos inválidos", details: parsed.error.flatten() }, { status: 400 });
    }

    const objetivo = await prisma.objetivo.create({
      data: {
        titulo: parsed.data.titulo,
        descripcion: parsed.data.descripcion ?? null,
        asignadoAId: parsed.data.asignadoAId ?? null,
        periodo: parsed.data.periodo,
        progreso: parsed.data.progreso ?? 0,
        creadoPorId: userId,
      },
      include: {
        asignadoA: { select: { id: true, nombre: true, apellidos: true, foto: true } },
        creadoPor: { select: { id: true, nombre: true, apellidos: true } },
      },
    });

    return NextResponse.json({ objetivo }, { status: 201 });
  } catch (error) {
    console.error("POST /api/objetivos error:", error);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}));

export { ESTADOS };
