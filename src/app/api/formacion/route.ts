import { auth } from "@/lib/auth";
import { prismaApp as prisma } from "@/lib/prisma";
import { Rol } from "@/generated/prisma-tenant/client";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withTenant } from "@/lib/tenant/with-tenant";
import { withFeature } from "@/lib/feature-guard/with-feature";

const createSchema = z.object({
  titulo: z.string().min(1).max(200),
  descripcion: z.string().max(2000).nullable().optional(),
  contenidoUrl: z.string().url().nullable().optional(),
  duracionMin: z.number().int().min(1).max(10000).optional(),
  asignadosA: z.array(z.string()).optional(),
});

export const GET = withTenant(withFeature("formacion", async () => {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const userId = session.user.id!;
  const userRol = (session.user as { rol?: Rol }).rol;
  if (userRol === Rol.OWNER || userRol === Rol.MANAGER) {
    const cursos = await prisma.curso.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        creadoPor: { select: { id: true, nombre: true, apellidos: true } },
        _count: { select: { asignaciones: true } },
      },
    });
    return NextResponse.json({ cursos });
  }
  // EMPLEADO: solo cursos asignados a sí mismo
  const asignaciones = await prisma.asignacionCurso.findMany({
    where: { empleadoId: userId },
    orderBy: { createdAt: "desc" },
    include: { curso: true },
  });
  return NextResponse.json({ asignaciones });
}));

export const POST = withTenant(withFeature("formacion", async (req: NextRequest) => {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const userId = session.user.id!;
  const userRol = (session.user as { rol?: Rol }).rol;
  if (userRol !== Rol.OWNER) return NextResponse.json({ error: "Solo el Administrador" }, { status: 403 });
  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });
  const curso = await prisma.curso.create({
    data: {
      titulo: parsed.data.titulo,
      descripcion: parsed.data.descripcion ?? null,
      contenidoUrl: parsed.data.contenidoUrl ?? null,
      duracionMin: parsed.data.duracionMin ?? 60,
      creadoPorId: userId,
      ...(parsed.data.asignadosA && parsed.data.asignadosA.length > 0
        ? { asignaciones: { create: parsed.data.asignadosA.map((empleadoId) => ({ empleadoId })) } }
        : {}),
    },
    include: {
      creadoPor: { select: { id: true, nombre: true, apellidos: true } },
      _count: { select: { asignaciones: true } },
    },
  });
  return NextResponse.json({ curso }, { status: 201 });
}));
