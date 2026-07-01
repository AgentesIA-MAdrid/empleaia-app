import { auth } from "@/lib/auth";
import { prismaApp as prisma } from "@/lib/prisma";
import { Rol } from "@/generated/prisma-tenant/client";
import { NextRequest, NextResponse } from "next/server";

import { withTenant } from "@/lib/tenant/with-tenant";

async function autorizar(id: string, session: { user?: { id?: string; rol?: Rol } } | null) {
  if (!session?.user) return { ok: false as const, status: 401, error: "No autorizado" };
  const userId = session.user.id!;
  const userRol = session.user.rol;

  const recurso = await prisma.articulo.findUnique({
    where: { id },
    select: { autorId: true },
  });
  if (!recurso) return { ok: false as const, status: 404, error: "Artículo no encontrado" };

  // Gestión = Administrador (OWNER) o el propio autor. El Coordinador
  // (MANAGER) no gestiona artículos de terceros: solo los que él creó.
  const permitido = userRol === Rol.OWNER || recurso.autorId === userId;
  if (!permitido) return { ok: false as const, status: 403, error: "No autorizado" };
  return { ok: true as const };
}

export const PUT = withTenant(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  try {
    const session = await auth();
    const { id } = await params;
    const auth_ = await autorizar(id, session as { user?: { id?: string; rol?: Rol } } | null);
    if (!auth_.ok) return NextResponse.json({ error: auth_.error }, { status: auth_.status });

    const body = await req.json();
    const articulo = await prisma.articulo.update({
      where: { id },
      data: {
        ...(body.titulo !== undefined && { titulo: body.titulo }),
        ...(body.contenido !== undefined && { contenido: body.contenido }),
        ...(body.categoria !== undefined && { categoria: body.categoria }),
        ...(body.publicado !== undefined && { publicado: body.publicado }),
      },
      include: { autor: { select: { nombre: true, apellidos: true } } },
    });

    return NextResponse.json({ articulo });
  } catch (error) {
    console.error("PUT /api/articulos/[id] error:", error);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
});

export const DELETE = withTenant(async (_req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  try {
    const session = await auth();
    const { id } = await params;
    const auth_ = await autorizar(id, session as { user?: { id?: string; rol?: Rol } } | null);
    if (!auth_.ok) return NextResponse.json({ error: auth_.error }, { status: auth_.status });

    await prisma.articulo.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("DELETE /api/articulos/[id] error:", error);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
});
