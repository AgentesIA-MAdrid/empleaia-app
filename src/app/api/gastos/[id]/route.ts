import { auth } from "@/lib/auth";
import { prismaApp as prisma } from "@/lib/prisma";
import { Rol } from "@/generated/prisma-tenant/client";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withTenant } from "@/lib/tenant/with-tenant";
import { withFeature } from "@/lib/feature-guard/with-feature";

const reviewSchema = z.object({
  estado: z.enum(["aprobado", "rechazado", "pendiente"]),
  comentarioRevision: z.string().max(1000).nullable().optional(),
});

export const PUT = withTenant(withFeature("control_gastos", async (
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) => {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const userId = session.user.id!;
  const userRol = (session.user as { rol?: Rol }).rol;
  if (userRol !== Rol.OWNER) return NextResponse.json({ error: "Solo el Administrador" }, { status: 403 });
  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = reviewSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });
  const gasto = await prisma.gasto.update({
    where: { id },
    data: {
      estado: parsed.data.estado,
      comentarioRevision: parsed.data.comentarioRevision ?? null,
      revisorId: userId,
      revisadoAt: new Date(),
    },
    include: {
      user: { select: { id: true, nombre: true, apellidos: true } },
      revisor: { select: { id: true, nombre: true, apellidos: true } },
    },
  });
  return NextResponse.json({ gasto });
}));

export const DELETE = withTenant(withFeature("control_gastos", async (
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) => {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const userId = session.user.id!;
  const userRol = (session.user as { rol?: Rol }).rol;
  const { id } = await params;
  const gasto = await prisma.gasto.findUnique({ where: { id }, select: { userId: true, estado: true } });
  if (!gasto) return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  // Gestión (borrar cualquier gasto) = Administrador (OWNER). El Coordinador
  // (MANAGER) actúa como empleado: solo su propio gasto pendiente.
  const esAdmin = userRol === Rol.OWNER;
  const esPropietarioPendiente = gasto.userId === userId && gasto.estado === "pendiente";
  if (!esAdmin && !esPropietarioPendiente) return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  await prisma.gasto.delete({ where: { id } });
  return NextResponse.json({ success: true });
}));
