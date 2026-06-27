/**
 * POST /api/denuncias/[id]/comentarios
 *
 * Añade un comentario a una denuncia. Reglas:
 *   - OWNER/MANAGER pueden añadir comentarios públicos o internos.
 *   - Asignado puede añadir comentarios públicos o internos.
 *   - Informante (informanteUserId) solo público.
 *   - Otros: 403.
 */

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { Rol } from "@/generated/prisma-tenant/client";
import { prismaApp } from "@/lib/prisma";
import { withTenant } from "@/lib/tenant/with-tenant";
import { withFeature } from "@/lib/feature-guard/with-feature";

const schema = z.object({
  contenido: z.string().min(1).max(5000),
  esInterno: z.boolean().default(false),
});

export const POST = withTenant(
  withFeature("canal_denuncias", async (
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> },
  ) => {
    const session = await auth();
    const user = session?.user as
      | { id?: string; rol?: Rol | string }
      | undefined;
    if (!user || !user.id) {
      return NextResponse.json({ error: "No autenticado" }, { status: 401 });
    }
    const { id } = await params;
    const denuncia = await prismaApp.denuncia.findUnique({
      where: { id },
      select: { id: true, asignadoUserId: true, informanteUserId: true },
    });
    if (!denuncia) {
      return NextResponse.json({ error: "No encontrada" }, { status: 404 });
    }

    const isAdmin = user.rol === Rol.OWNER || user.rol === Rol.MANAGER;
    const isAsignado = denuncia.asignadoUserId === user.id;
    const isInformante = denuncia.informanteUserId === user.id;
    if (!isAdmin && !isAsignado && !isInformante) {
      return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Body inválido" }, { status: 400 });
    }
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Datos inválidos" },
        { status: 400 },
      );
    }
    const data = parsed.data;

    // El informante NO puede marcar comentarios como internos.
    const esInterno = isAdmin || isAsignado ? data.esInterno : false;
    const autorRole = isAdmin ? "owner" : isAsignado ? "instructor" : "informante";

    const comentario = await prismaApp.comentarioDenuncia.create({
      data: {
        denunciaId: id,
        autorUserId: user.id,
        autorRole,
        contenido: data.contenido,
        esInterno,
      },
    });

    return NextResponse.json({ comentario }, { status: 201 });
  }),
);
