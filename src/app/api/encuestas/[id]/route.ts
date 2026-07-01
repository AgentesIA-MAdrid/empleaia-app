/**
 * GET /api/encuestas/[id]
 *   OWNER/MANAGER: detalle completo + resultados agregados.
 *   EMPLEADO: solo si la encuesta está abierta + ya/no respondida.
 *
 * PUT /api/encuestas/[id] — actualiza titulo/descripcion/estado/cierraAt.
 *   OWNER/MANAGER. Preguntas y `anonima` NO son editables tras crear
 *   (afectaría a la integridad de respuestas ya recibidas).
 *
 * DELETE /api/encuestas/[id] — OWNER/MANAGER. Cascade borra respuestas.
 *
 * Feature: `encuestas_clima`.
 */

import { auth } from "@/lib/auth";
import { prismaApp as prisma } from "@/lib/prisma";
import { Rol } from "@/generated/prisma-tenant/client";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { withTenant } from "@/lib/tenant/with-tenant";
import { withFeature } from "@/lib/feature-guard/with-feature";

const updateSchema = z.object({
  titulo: z.string().min(1).max(200).optional(),
  descripcion: z.string().max(2000).nullable().optional(),
  estado: z.enum(["borrador", "abierta", "cerrada"]).optional(),
  cierraAt: z.string().datetime().nullable().optional(),
});

export const GET = withTenant(withFeature("encuestas_clima", async (
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) => {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    const userRol = (session.user as { rol?: Rol }).rol;
    const userId = session.user.id!;

    const { id } = await params;
    const encuesta = await prisma.encuesta.findUnique({
      where: { id },
      include: {
        creadoPor: { select: { id: true, nombre: true, apellidos: true } },
        _count: { select: { respuestas: true } },
      },
    });
    if (!encuesta) return NextResponse.json({ error: "Encuesta no encontrada" }, { status: 404 });

    const esAdmin = userRol === Rol.OWNER || userRol === Rol.MANAGER;
    if (!esAdmin && encuesta.estado !== "abierta") {
      return NextResponse.json({ error: "No autorizado" }, { status: 403 });
    }

    if (esAdmin) {
      // Resultados agregados — solo OWNER/MANAGER.
      const respuestas = await prisma.respuestaEncuesta.findMany({
        where: { encuestaId: id },
        select: { respuestas: true, createdAt: true },
      });
      return NextResponse.json({ encuesta, respuestas });
    }

    // EMPLEADO: ¿ya respondida?
    const yaRespuesta = await prisma.respuestaEncuesta.findFirst({
      where: { encuestaId: id, userId },
      select: { id: true },
    });
    return NextResponse.json({
      encuesta: {
        id: encuesta.id,
        titulo: encuesta.titulo,
        descripcion: encuesta.descripcion,
        preguntas: encuesta.preguntas,
        anonima: encuesta.anonima,
        cierraAt: encuesta.cierraAt,
      },
      yaRespondida: !!yaRespuesta,
    });
  } catch (error) {
    console.error("GET /api/encuestas/[id] error:", error);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}));

export const PUT = withTenant(withFeature("encuestas_clima", async (
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) => {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    const userRol = (session.user as { rol?: Rol }).rol;
    if (userRol !== Rol.OWNER) {
      return NextResponse.json({ error: "No autorizado" }, { status: 403 });
    }

    const { id } = await params;
    const existing = await prisma.encuesta.findUnique({ where: { id }, select: { id: true } });
    if (!existing) return NextResponse.json({ error: "Encuesta no encontrada" }, { status: 404 });

    let body: unknown;
    try { body = await req.json(); } catch { return NextResponse.json({ error: "Body inválido" }, { status: 400 }); }
    const parsed = updateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Datos inválidos", details: parsed.error.flatten() }, { status: 400 });
    }

    const data: Record<string, unknown> = {};
    if (parsed.data.titulo !== undefined) data.titulo = parsed.data.titulo;
    if (parsed.data.descripcion !== undefined) data.descripcion = parsed.data.descripcion;
    if (parsed.data.estado !== undefined) data.estado = parsed.data.estado;
    if (parsed.data.cierraAt !== undefined) {
      data.cierraAt = parsed.data.cierraAt ? new Date(parsed.data.cierraAt) : null;
    }

    const encuesta = await prisma.encuesta.update({
      where: { id },
      data,
      include: {
        creadoPor: { select: { id: true, nombre: true, apellidos: true } },
        _count: { select: { respuestas: true } },
      },
    });

    return NextResponse.json({ encuesta });
  } catch (error) {
    console.error("PUT /api/encuestas/[id] error:", error);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}));

export const DELETE = withTenant(withFeature("encuestas_clima", async (
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) => {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    const userRol = (session.user as { rol?: Rol }).rol;
    if (userRol !== Rol.OWNER) {
      return NextResponse.json({ error: "No autorizado" }, { status: 403 });
    }
    const { id } = await params;
    await prisma.encuesta.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("DELETE /api/encuestas/[id] error:", error);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}));
