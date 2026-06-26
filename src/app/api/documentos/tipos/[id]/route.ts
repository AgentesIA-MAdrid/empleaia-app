/**
 * PUT    /api/documentos/tipos/[id] — renombra un tipo (OWNER). Body: { nombre }.
 * DELETE /api/documentos/tipos/[id] — elimina un tipo del catálogo (OWNER).
 *   Los documentos con ese tipo no se borran; quedan como carpeta "huérfana".
 */

import { auth } from "@/lib/auth";
import { prismaApp as prisma } from "@/lib/prisma";
import { Rol } from "@/generated/prisma-tenant/client";
import type { NextRequest } from "next/server";
import { withTenant } from "@/lib/tenant/with-tenant";

export const PUT = withTenant(async (request: NextRequest,
  { params }: { params: Promise<{ id: string }> }) => {
  try {
    const session = await auth();
    if (!session?.user) return Response.json({ error: "No autorizado" }, { status: 401 });
    if ((session.user as { rol?: Rol }).rol !== Rol.OWNER) {
      return Response.json({ error: "No autorizado" }, { status: 403 });
    }
    const { id } = await params;
    const body = await request.json().catch(() => null);
    const nombre = typeof body?.nombre === "string" ? body.nombre.trim() : "";
    if (nombre.length < 2) return Response.json({ error: "Nombre no válido" }, { status: 400 });

    const tipo = await prisma.tipoDocumento.update({
      where: { id },
      data: { nombre },
      select: { id: true, nombre: true, slug: true, orden: true },
    });
    return Response.json(tipo);
  } catch (error) {
    console.error("PUT /api/documentos/tipos/[id] error:", error);
    return Response.json({ error: "Error interno del servidor" }, { status: 500 });
  }
});

export const DELETE = withTenant(async (_request: NextRequest,
  { params }: { params: Promise<{ id: string }> }) => {
  try {
    const session = await auth();
    if (!session?.user) return Response.json({ error: "No autorizado" }, { status: 401 });
    if ((session.user as { rol?: Rol }).rol !== Rol.OWNER) {
      return Response.json({ error: "No autorizado" }, { status: 403 });
    }
    const { id } = await params;
    await prisma.tipoDocumento.delete({ where: { id } });
    return Response.json({ success: true });
  } catch (error) {
    console.error("DELETE /api/documentos/tipos/[id] error:", error);
    return Response.json({ error: "Error interno del servidor" }, { status: 500 });
  }
});
