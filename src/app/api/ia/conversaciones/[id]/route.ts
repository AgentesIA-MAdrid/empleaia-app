/**
 * /api/ia/conversaciones/[id]
 *   GET     → detalle con mensajes (solo el dueño)
 *   PATCH   → renombrar título
 *   DELETE  → borrar conversación + mensajes (CASCADE)
 */

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { Rol } from "@/generated/prisma-tenant/client";
import { prismaApp } from "@/lib/prisma";
import { withTenant } from "@/lib/tenant/with-tenant";
import { withFeature } from "@/lib/feature-guard/with-feature";

const patchSchema = z.object({
  titulo: z.string().min(1).max(200),
});

export const GET = withTenant(withFeature("asistente_ia", async (
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) => {
  const session = await auth();
  const user = session?.user as { id?: string; rol?: Rol | string } | undefined;
  if (!user?.id) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const { id } = await params;
  const conv = await prismaApp.conversacionIA.findUnique({
    where: { id },
    include: {
      mensajes: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!conv) return NextResponse.json({ error: "No encontrada" }, { status: 404 });
  if (conv.userId !== user.id && user.rol !== Rol.OWNER) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }
  return NextResponse.json({ conversacion: conv });
}));

export const PATCH = withTenant(withFeature("asistente_ia", async (
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) => {
  const session = await auth();
  const user = session?.user as { id?: string } | undefined;
  if (!user?.id) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const { id } = await params;
  const conv = await prismaApp.conversacionIA.findUnique({ where: { id }, select: { userId: true } });
  if (!conv) return NextResponse.json({ error: "No encontrada" }, { status: 404 });
  if (conv.userId !== user.id) return NextResponse.json({ error: "Sin permisos" }, { status: 403 });

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Body inválido" }, { status: 400 }); }
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });

  const updated = await prismaApp.conversacionIA.update({
    where: { id },
    data: { titulo: parsed.data.titulo },
  });
  return NextResponse.json({ conversacion: updated });
}));

export const DELETE = withTenant(withFeature("asistente_ia", async (
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) => {
  const session = await auth();
  const user = session?.user as { id?: string } | undefined;
  if (!user?.id) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const { id } = await params;
  const conv = await prismaApp.conversacionIA.findUnique({ where: { id }, select: { userId: true } });
  if (!conv) return NextResponse.json({ error: "No encontrada" }, { status: 404 });
  if (conv.userId !== user.id) return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  await prismaApp.conversacionIA.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}));
