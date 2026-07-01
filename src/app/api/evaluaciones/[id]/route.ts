import { auth } from "@/lib/auth";
import { prismaApp as prisma } from "@/lib/prisma";
import { Rol } from "@/generated/prisma-tenant/client";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withTenant } from "@/lib/tenant/with-tenant";
import { withFeature } from "@/lib/feature-guard/with-feature";

const updateSchema = z.object({
  respuestas: z.array(z.object({
    preguntaIdx: z.number().int().min(0),
    valor: z.union([z.number().int(), z.string().max(2000)]),
  })).optional(),
  comentarios: z.string().max(2000).nullable().optional(),
  estado: z.enum(["pendiente", "completada"]).optional(),
});

export const GET = withTenant(withFeature("evaluaciones", async (
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) => {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const userId = session.user.id!;
  const userRol = (session.user as { rol?: Rol }).rol;
  const { id } = await params;
  const ev = await prisma.evaluacion.findUnique({
    where: { id },
    include: {
      evaluadoA: { select: { id: true, nombre: true, apellidos: true, foto: true } },
      evaluador: { select: { id: true, nombre: true, apellidos: true } },
    },
  });
  if (!ev) return NextResponse.json({ error: "No encontrada" }, { status: 404 });
  const esAdmin = userRol === Rol.OWNER || userRol === Rol.MANAGER;
  if (!esAdmin && ev.evaluadorId !== userId && ev.evaluadoAId !== userId) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }
  return NextResponse.json({ evaluacion: ev });
}));

export const PUT = withTenant(withFeature("evaluaciones", async (
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) => {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const userId = session.user.id!;
  const userRol = (session.user as { rol?: Rol }).rol;
  const { id } = await params;
  const ev = await prisma.evaluacion.findUnique({ where: { id }, select: { evaluadorId: true, estado: true } });
  if (!ev) return NextResponse.json({ error: "No encontrada" }, { status: 404 });
  // Gestión = Administrador (OWNER). El Coordinador (MANAGER) actúa como
  // empleado: solo puede rellenar la evaluación de la que es evaluador.
  const esAdmin = userRol === Rol.OWNER;
  if (!esAdmin && ev.evaluadorId !== userId) return NextResponse.json({ error: "No autorizado" }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });

  const data: Record<string, unknown> = {};
  if (parsed.data.respuestas !== undefined) data.respuestas = parsed.data.respuestas;
  if (parsed.data.comentarios !== undefined) data.comentarios = parsed.data.comentarios;
  if (parsed.data.estado !== undefined) {
    data.estado = parsed.data.estado;
    if (parsed.data.estado === "completada") data.completadaAt = new Date();
  }
  const updated = await prisma.evaluacion.update({
    where: { id }, data,
    include: {
      evaluadoA: { select: { id: true, nombre: true, apellidos: true, foto: true } },
      evaluador: { select: { id: true, nombre: true, apellidos: true } },
    },
  });
  return NextResponse.json({ evaluacion: updated });
}));

export const DELETE = withTenant(withFeature("evaluaciones", async (
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) => {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const userRol = (session.user as { rol?: Rol }).rol;
  if (userRol !== Rol.OWNER) return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  const { id } = await params;
  await prisma.evaluacion.delete({ where: { id } });
  return NextResponse.json({ success: true });
}));
