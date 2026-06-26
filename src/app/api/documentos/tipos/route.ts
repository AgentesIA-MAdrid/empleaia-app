/**
 * GET  /api/documentos/tipos — catálogo de tipos/carpetas (cualquier usuario).
 * POST /api/documentos/tipos — crea un tipo (OWNER). Body: { nombre }.
 *
 * El `slug` se deriva del nombre (normalizado) y es la clave que se guarda
 * en `Documento.tipo`.
 */

import { auth } from "@/lib/auth";
import { prismaApp as prisma } from "@/lib/prisma";
import { Rol } from "@/generated/prisma-tenant/client";
import type { NextRequest } from "next/server";
import { withTenant } from "@/lib/tenant/with-tenant";

export function slugify(nombre: string): string {
  return nombre
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export const GET = withTenant(async () => {
  try {
    const session = await auth();
    if (!session?.user) return Response.json({ error: "No autorizado" }, { status: 401 });
    const tipos = await prisma.tipoDocumento.findMany({
      orderBy: [{ orden: "asc" }, { nombre: "asc" }],
      select: { id: true, nombre: true, slug: true, orden: true },
    });
    return Response.json({ tipos });
  } catch (error) {
    console.error("GET /api/documentos/tipos error:", error);
    return Response.json({ error: "Error interno del servidor" }, { status: 500 });
  }
});

export const POST = withTenant(async (request: NextRequest) => {
  try {
    const session = await auth();
    if (!session?.user) return Response.json({ error: "No autorizado" }, { status: 401 });
    if ((session.user as { rol?: Rol }).rol !== Rol.OWNER) {
      return Response.json({ error: "No autorizado" }, { status: 403 });
    }
    const body = await request.json().catch(() => null);
    const nombre = typeof body?.nombre === "string" ? body.nombre.trim() : "";
    if (nombre.length < 2) {
      return Response.json({ error: "El nombre es obligatorio" }, { status: 400 });
    }
    const slug = slugify(nombre);
    if (!slug) return Response.json({ error: "Nombre no válido" }, { status: 400 });

    const existe = await prisma.tipoDocumento.findUnique({ where: { slug }, select: { id: true } });
    if (existe) return Response.json({ error: "Ya existe un tipo con ese nombre" }, { status: 409 });

    const max = await prisma.tipoDocumento.aggregate({ _max: { orden: true } });
    const tipo = await prisma.tipoDocumento.create({
      data: { nombre, slug, orden: (max._max.orden ?? -1) + 1 },
      select: { id: true, nombre: true, slug: true, orden: true },
    });
    return Response.json(tipo, { status: 201 });
  } catch (error) {
    console.error("POST /api/documentos/tipos error:", error);
    return Response.json({ error: "Error interno del servidor" }, { status: 500 });
  }
});
