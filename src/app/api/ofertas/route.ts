/**
 * /api/ofertas — gestión de ofertas de trabajo (Reclutamiento ATS).
 *
 *   GET  → listar (admin: todas, otros: solo abiertas)
 *   POST → crear (admin only)
 */

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { Rol } from "@/generated/prisma-tenant/client";
import { prismaApp } from "@/lib/prisma";
import { withTenant } from "@/lib/tenant/with-tenant";
import { withFeature } from "@/lib/feature-guard/with-feature";

const ESTADOS = ["borrador", "abierta", "pausada", "cerrada"] as const;

const createSchema = z.object({
  titulo: z.string().min(3).max(200),
  descripcion: z.string().min(20).max(10000),
  departamento: z.string().max(100).optional(),
  ubicacion: z.string().max(120).optional(),
  modalidad: z.string().max(40).optional(),
  salarioMinCents: z.number().int().nonnegative().optional(),
  salarioMaxCents: z.number().int().nonnegative().optional(),
  estado: z.enum(ESTADOS).default("borrador"),
  fechaCierre: z.string().datetime().optional(),
});

export const POST = withTenant(withFeature("reclutamiento", async (req: NextRequest) => {
  const session = await auth();
  const user = session?.user as { id?: string; rol?: Rol | string } | undefined;
  // Crear ofertas es gestión: solo el Administrador (OWNER).
  if (!user?.id || user.rol !== Rol.OWNER) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Datos inválidos" },
      { status: 400 },
    );
  }
  const data = parsed.data;
  if (data.salarioMinCents && data.salarioMaxCents && data.salarioMinCents > data.salarioMaxCents) {
    return NextResponse.json(
      { error: "El salario mínimo no puede ser superior al máximo" },
      { status: 400 },
    );
  }

  const oferta = await prismaApp.ofertaTrabajo.create({
    data: {
      titulo: data.titulo,
      descripcion: data.descripcion,
      departamento: data.departamento,
      ubicacion: data.ubicacion,
      modalidad: data.modalidad,
      salarioMinCents: data.salarioMinCents,
      salarioMaxCents: data.salarioMaxCents,
      estado: data.estado,
      fechaCierre: data.fechaCierre ? new Date(data.fechaCierre) : null,
      creadorId: user.id,
    },
  });
  return NextResponse.json({ oferta }, { status: 201 });
}));

export const GET = withTenant(withFeature("reclutamiento", async (req: NextRequest) => {
  const session = await auth();
  const user = session?.user as { rol?: Rol | string } | undefined;
  const isAdmin = user?.rol === Rol.OWNER || user?.rol === Rol.MANAGER;

  const url = req.nextUrl;
  const estado = url.searchParams.get("estado");
  const where: Record<string, unknown> = {};
  if (estado) where.estado = estado;
  else if (!isAdmin) where.estado = "abierta";

  const items = await prismaApp.ofertaTrabajo.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 200,
    include: {
      _count: { select: { candidatos: true } },
      creador: { select: { nombre: true, apellidos: true } },
    },
  });
  return NextResponse.json({ items, total: items.length });
}));
