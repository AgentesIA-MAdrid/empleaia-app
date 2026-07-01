import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { Rol } from "@/generated/prisma-tenant/client";
import { prismaApp } from "@/lib/prisma";
import { withTenant } from "@/lib/tenant/with-tenant";
import { withFeature } from "@/lib/feature-guard/with-feature";

const schema = z.object({
  nombre: z.string().min(2).max(120),
  apellidos: z.string().min(2).max(120),
  email: z.string().email(),
  telefono: z.string().max(40).optional(),
  cvUrl: z.string().url().optional().or(z.literal("")).optional(),
  linkedinUrl: z.string().url().optional().or(z.literal("")).optional(),
  notas: z.string().max(2000).optional(),
});

export const POST = withTenant(withFeature("reclutamiento", async (
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) => {
  const session = await auth();
  const user = session?.user as { id?: string; rol?: Rol | string } | undefined;
  // Añadir candidatos es gestión: solo el Administrador (OWNER).
  if (!user?.id || user.rol !== Rol.OWNER) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }
  const { id: ofertaId } = await params;
  const oferta = await prismaApp.ofertaTrabajo.findUnique({
    where: { id: ofertaId },
    select: { id: true },
  });
  if (!oferta) {
    return NextResponse.json({ error: "Oferta no encontrada" }, { status: 404 });
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

  const candidato = await prismaApp.candidato.create({
    data: {
      ofertaId,
      nombre: data.nombre,
      apellidos: data.apellidos,
      email: data.email,
      telefono: data.telefono,
      cvUrl: data.cvUrl || null,
      linkedinUrl: data.linkedinUrl || null,
      notas: data.notas,
      creadorId: user.id,
    },
  });
  return NextResponse.json({ candidato }, { status: 201 });
}));
