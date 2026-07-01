/**
 * POST /api/prenomina/[id]/cerrar — BORRADOR → CERRADA.
 * Solo OWNER/MANAGER. La prenómina queda inmutable hasta reabrir.
 */

import { auth } from "@/lib/auth";
import { prismaApp as prisma } from "@/lib/prisma";
import { Rol } from "@/generated/prisma-tenant/client";
import { NextResponse } from "next/server";
import { withTenant } from "@/lib/tenant/with-tenant";
import { withFeature } from "@/lib/feature-guard/with-feature";

export const POST = withTenant(
  withFeature("prenomina", async (
    _req: Request,
    { params }: { params: Promise<{ id: string }> },
  ) => {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    const userRol = (session.user as { rol?: Rol }).rol;
    if (userRol !== Rol.OWNER) {
      return NextResponse.json({ error: "Solo el Administrador" }, { status: 403 });
    }
    const userId = (session.user as { id?: string }).id;
    if (!userId) return NextResponse.json({ error: "Sesión inválida" }, { status: 401 });

    const { id } = await params;
    const pre = await prisma.prenomina.findUnique({ where: { id }, select: { estado: true } });
    if (!pre) return NextResponse.json({ error: "Prenómina no encontrada" }, { status: 404 });
    if (pre.estado !== "BORRADOR") {
      return NextResponse.json(
        { error: `No se puede cerrar una prenómina en estado ${pre.estado}` },
        { status: 400 },
      );
    }

    await prisma.prenomina.update({
      where: { id },
      data: {
        estado: "CERRADA",
        cerradaAt: new Date(),
        cerradaPorId: userId,
      },
    });

    return NextResponse.json({ ok: true });
  }),
);
