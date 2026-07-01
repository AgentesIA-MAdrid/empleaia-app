import { auth } from "@/lib/auth";
import { prismaApp as prisma } from "@/lib/prisma";
import { Rol } from "@/generated/prisma-tenant/client";
import { type NextRequest, NextResponse } from "next/server";
import { withTenant } from "@/lib/tenant/with-tenant";
import { withFeature } from "@/lib/feature-guard/with-feature";

export const DELETE = withTenant(withFeature("reserva_espacios", async (
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) => {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const userId = session.user.id!;
  const userRol = (session.user as { rol?: Rol }).rol;
  const { id } = await params;
  const reserva = await prisma.reservaEspacio.findUnique({ where: { id }, select: { userId: true } });
  if (!reserva) return NextResponse.json({ error: "No encontrada" }, { status: 404 });
  // Cancelar cualquier reserva = Administrador (OWNER). El Coordinador
  // (MANAGER) actúa como empleado: solo la suya.
  const esAdmin = userRol === Rol.OWNER;
  if (!esAdmin && reserva.userId !== userId) return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  await prisma.reservaEspacio.delete({ where: { id } });
  return NextResponse.json({ success: true });
}));
