/**
 * POST   /api/prenomina/[id]/conceptos — añade un concepto manual.
 * DELETE /api/prenomina/[id]/conceptos?conceptoId=X — borra uno.
 *
 * Solo permitido cuando la prenómina está en BORRADOR. Recalcula
 * `importeConceptos` y `totalBruto` en cada cambio.
 */

import { auth } from "@/lib/auth";
import { prismaApp as prisma } from "@/lib/prisma";
import { Rol, TipoConceptoPrenomina } from "@/generated/prisma-tenant/client";
import { type NextRequest, NextResponse } from "next/server";
import { withTenant } from "@/lib/tenant/with-tenant";
import { withFeature } from "@/lib/feature-guard/with-feature";
import { z } from "zod";

const conceptoSchema = z.object({
  tipo: z.enum([
    "DIETA",
    "KILOMETRAJE",
    "COMISION",
    "PLUS",
    "BONUS",
    "DEDUCCION",
    "OTRO",
  ]),
  descripcion: z.string().min(1).max(200),
  cantidad: z.number().nullable().optional(),
  importe: z.number(),
  notas: z.string().max(500).nullable().optional(),
});

async function recomputeTotals(prenominaId: string) {
  const pre = await prisma.prenomina.findUnique({
    where: { id: prenominaId },
    include: { conceptos: true },
  });
  if (!pre) return;
  const importeConceptos = pre.conceptos.reduce(
    (acc, c) => acc + Number(c.importe),
    0,
  );
  const totalBruto =
    Number(pre.salarioBase) +
    Number(pre.importeHorasExtras) +
    Number(pre.importeNocturnidad) +
    Number(pre.importeFestivos) +
    importeConceptos;
  await prisma.prenomina.update({
    where: { id: prenominaId },
    data: {
      importeConceptos: Math.round(importeConceptos * 100) / 100,
      totalBruto: Math.round(totalBruto * 100) / 100,
    },
  });
}

export const POST = withTenant(
  withFeature("prenomina", async (
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> },
  ) => {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    const userRol = (session.user as { rol?: Rol }).rol;
    if (userRol !== Rol.OWNER) {
      return NextResponse.json({ error: "Solo el Administrador" }, { status: 403 });
    }

    const { id } = await params;
    const pre = await prisma.prenomina.findUnique({
      where: { id },
      select: { estado: true },
    });
    if (!pre) return NextResponse.json({ error: "Prenómina no encontrada" }, { status: 404 });
    if (pre.estado !== "BORRADOR") {
      return NextResponse.json(
        { error: "Solo se pueden editar conceptos en BORRADOR" },
        { status: 400 },
      );
    }

    const body = await req.json().catch(() => null);
    const parsed = conceptoSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Datos inválidos" },
        { status: 400 },
      );
    }

    const concepto = await prisma.prenominaConcepto.create({
      data: {
        prenominaId: id,
        tipo: parsed.data.tipo as TipoConceptoPrenomina,
        descripcion: parsed.data.descripcion,
        cantidad: parsed.data.cantidad ?? null,
        importe: parsed.data.importe,
        notas: parsed.data.notas ?? null,
      },
    });
    await recomputeTotals(id);

    return NextResponse.json({ ok: true, concepto });
  }),
);

export const DELETE = withTenant(
  withFeature("prenomina", async (
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> },
  ) => {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    const userRol = (session.user as { rol?: Rol }).rol;
    if (userRol !== Rol.OWNER) {
      return NextResponse.json({ error: "Solo el Administrador" }, { status: 403 });
    }

    const { id } = await params;
    const conceptoId = req.nextUrl.searchParams.get("conceptoId");
    if (!conceptoId) {
      return NextResponse.json({ error: "conceptoId requerido" }, { status: 400 });
    }

    const pre = await prisma.prenomina.findUnique({
      where: { id },
      select: { estado: true },
    });
    if (!pre) return NextResponse.json({ error: "Prenómina no encontrada" }, { status: 404 });
    if (pre.estado !== "BORRADOR") {
      return NextResponse.json(
        { error: "Solo se pueden editar conceptos en BORRADOR" },
        { status: 400 },
      );
    }

    await prisma.prenominaConcepto.delete({ where: { id: conceptoId } });
    await recomputeTotals(id);

    return NextResponse.json({ ok: true });
  }),
);
