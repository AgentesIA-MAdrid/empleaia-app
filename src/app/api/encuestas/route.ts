/**
 * GET /api/encuestas
 *   OWNER/MANAGER: lista todas las encuestas con conteo de respuestas.
 *   EMPLEADO: solo encuestas abiertas; cada una incluye `yaRespondida`.
 *
 * POST /api/encuestas — crea encuesta. OWNER/MANAGER.
 *
 * Feature: `encuestas_clima` (pro+enterprise).
 */

import { auth } from "@/lib/auth";
import { prismaApp as prisma } from "@/lib/prisma";
import { Rol } from "@/generated/prisma-tenant/client";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { withTenant } from "@/lib/tenant/with-tenant";
import { withFeature } from "@/lib/feature-guard/with-feature";
import { preguntasSchema } from "@/lib/encuestas/types";

const createSchema = z.object({
  titulo: z.string().min(1).max(200),
  descripcion: z.string().max(2000).optional().nullable(),
  preguntas: preguntasSchema,
  anonima: z.boolean().optional(),
  cierraAt: z.string().datetime().nullable().optional(),
});

export const GET = withTenant(withFeature("encuestas_clima", async () => {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    const userId = session.user.id!;
    const userRol = (session.user as { rol?: Rol }).rol;

    if (userRol === Rol.OWNER || userRol === Rol.MANAGER) {
      const encuestas = await prisma.encuesta.findMany({
        orderBy: [{ estado: "asc" }, { createdAt: "desc" }],
        include: {
          creadoPor: { select: { id: true, nombre: true, apellidos: true } },
          _count: { select: { respuestas: true } },
        },
      });
      return NextResponse.json({ encuestas });
    }

    // EMPLEADO: solo abiertas; con flag yaRespondida.
    const encuestas = await prisma.encuesta.findMany({
      where: { estado: "abierta" },
      orderBy: { createdAt: "desc" },
      select: {
        id: true, titulo: true, descripcion: true, preguntas: true,
        anonima: true, cierraAt: true, createdAt: true,
      },
    });
    const respondidas = await prisma.respuestaEncuesta.findMany({
      where: { userId, encuestaId: { in: encuestas.map((e) => e.id) } },
      select: { encuestaId: true },
    });
    const respondidasSet = new Set(respondidas.map((r) => r.encuestaId));
    return NextResponse.json({
      encuestas: encuestas.map((e) => ({ ...e, yaRespondida: respondidasSet.has(e.id) })),
    });
  } catch (error) {
    console.error("GET /api/encuestas error:", error);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}));

export const POST = withTenant(withFeature("encuestas_clima", async (req: NextRequest) => {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    const userId = session.user.id!;
    const userRol = (session.user as { rol?: Rol }).rol;
    if (userRol !== Rol.OWNER) {
      return NextResponse.json({ error: "Solo el Administrador puede crear encuestas" }, { status: 403 });
    }

    let body: unknown;
    try { body = await req.json(); } catch { return NextResponse.json({ error: "Body inválido" }, { status: 400 }); }
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Datos inválidos", details: parsed.error.flatten() }, { status: 400 });
    }

    // Validación extra: si tipo=opcion, opciones obligatorias.
    for (const p of parsed.data.preguntas) {
      if (p.tipo === "opcion" && (!p.opciones || p.opciones.length < 2)) {
        return NextResponse.json(
          { error: `Pregunta ${p.idx}: las opciones múltiples requieren al menos 2 opciones` },
          { status: 400 },
        );
      }
    }

    const encuesta = await prisma.encuesta.create({
      data: {
        titulo: parsed.data.titulo,
        descripcion: parsed.data.descripcion ?? null,
        preguntas: parsed.data.preguntas,
        anonima: parsed.data.anonima ?? true,
        cierraAt: parsed.data.cierraAt ? new Date(parsed.data.cierraAt) : null,
        creadoPorId: userId,
      },
      include: {
        creadoPor: { select: { id: true, nombre: true, apellidos: true } },
      },
    });

    return NextResponse.json({ encuesta }, { status: 201 });
  } catch (error) {
    console.error("POST /api/encuestas error:", error);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}));
