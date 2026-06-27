/**
 * /api/ia/conversaciones
 *   GET   → listar conversaciones del usuario actual (más recientes primero)
 *   POST  → crear conversación nueva (vacía, con título "Nueva conversación")
 */

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { Rol } from "@/generated/prisma-tenant/client";
import { prismaApp } from "@/lib/prisma";
import { withTenant } from "@/lib/tenant/with-tenant";
import { withFeature } from "@/lib/feature-guard/with-feature";

function isAdminRole(rol: unknown): boolean {
  return rol === Rol.OWNER || rol === Rol.MANAGER;
}

export const GET = withTenant(withFeature("asistente_ia", async () => {
  const session = await auth();
  const user = session?.user as { id?: string; rol?: Rol | string } | undefined;
  if (!user?.id) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (!isAdminRole(user.rol)) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }
  const items = await prismaApp.conversacionIA.findMany({
    where: { userId: user.id },
    orderBy: { updatedAt: "desc" },
    take: 100,
    select: {
      id: true,
      titulo: true,
      createdAt: true,
      updatedAt: true,
      _count: { select: { mensajes: true } },
    },
  });
  return NextResponse.json({ items });
}));

export const POST = withTenant(withFeature("asistente_ia", async () => {
  const session = await auth();
  const user = session?.user as { id?: string; rol?: Rol | string } | undefined;
  if (!user?.id) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (!isAdminRole(user.rol)) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }
  const conv = await prismaApp.conversacionIA.create({
    data: {
      userId: user.id,
      titulo: "Nueva conversación",
    },
  });
  return NextResponse.json({ conversacion: conv }, { status: 201 });
}));
