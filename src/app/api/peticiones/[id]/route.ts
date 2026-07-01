import { auth } from "@/lib/auth";
import { prismaApp as prisma } from "@/lib/prisma";
import { Rol } from "@/generated/prisma-tenant/client";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withTenant } from "@/lib/tenant/with-tenant";
import { withFeature } from "@/lib/feature-guard/with-feature";

const updateSchema = z.object({
  estado: z.enum(["pendiente", "en_proceso", "resuelta", "rechazada"]).optional(),
  respuesta: z.string().max(5000).nullable().optional(),
});

export const PUT = withTenant(withFeature("custom_requests", async (
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
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });
  const data: Record<string, unknown> = { gestorId: userId };
  if (parsed.data.estado !== undefined) {
    data.estado = parsed.data.estado;
    if (parsed.data.estado === "resuelta" || parsed.data.estado === "rechazada") data.resueltaAt = new Date();
  }
  if (parsed.data.respuesta !== undefined) data.respuesta = parsed.data.respuesta;
  const peticion = await prisma.peticion.update({
    where: { id }, data,
    include: {
      solicitante: { select: { id: true, nombre: true, apellidos: true } },
      gestor: { select: { id: true, nombre: true, apellidos: true } },
    },
  });
  return NextResponse.json({ peticion });
}));

export const DELETE = withTenant(withFeature("custom_requests", async (
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) => {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const userId = session.user.id!;
  const userRol = (session.user as { rol?: Rol }).rol;
  const { id } = await params;
  const p = await prisma.peticion.findUnique({ where: { id }, select: { solicitanteId: true, estado: true } });
  if (!p) return NextResponse.json({ error: "No encontrada" }, { status: 404 });
  // Gestión = Administrador (OWNER). El Coordinador (MANAGER) actúa como
  // empleado: solo su propia petición pendiente.
  const esAdmin = userRol === Rol.OWNER;
  const esDueñoPendiente = p.solicitanteId === userId && p.estado === "pendiente";
  if (!esAdmin && !esDueñoPendiente) return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  await prisma.peticion.delete({ where: { id } });
  return NextResponse.json({ success: true });
}));
