import { auth } from "@/lib/auth";
import { prismaApp as prisma } from "@/lib/prisma";
import { Rol } from "@/generated/prisma-tenant/client";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withTenant } from "@/lib/tenant/with-tenant";
import { withFeature } from "@/lib/feature-guard/with-feature";

const preguntaSchema = z.object({
  idx: z.number().int().min(0),
  texto: z.string().min(1).max(500),
  tipo: z.enum(["escala_1_5", "texto"]),
});
const createSchema = z.object({
  ciclo: z.string().min(1).max(50),
  evaluadoAId: z.string().min(1),
  evaluadorId: z.string().min(1),
  preguntas: z.array(preguntaSchema).min(1).max(30),
});

export const GET = withTenant(withFeature("evaluaciones", async () => {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const userId = session.user.id!;
  const userRol = (session.user as { rol?: Rol }).rol;
  const where = userRol === Rol.OWNER || userRol === Rol.MANAGER
    ? {}
    : { OR: [{ evaluadoAId: userId }, { evaluadorId: userId }] };
  const evaluaciones = await prisma.evaluacion.findMany({
    where,
    orderBy: [{ estado: "asc" }, { createdAt: "desc" }],
    include: {
      evaluadoA: { select: { id: true, nombre: true, apellidos: true, foto: true } },
      evaluador: { select: { id: true, nombre: true, apellidos: true } },
    },
  });
  return NextResponse.json({ evaluaciones });
}));

export const POST = withTenant(withFeature("evaluaciones", async (req: NextRequest) => {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const userRol = (session.user as { rol?: Rol }).rol;
  if (userRol !== Rol.OWNER) {
    return NextResponse.json({ error: "Solo el Administrador" }, { status: 403 });
  }
  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos", details: parsed.error.flatten() }, { status: 400 });
  const ev = await prisma.evaluacion.create({
    data: { ...parsed.data, preguntas: parsed.data.preguntas },
    include: {
      evaluadoA: { select: { id: true, nombre: true, apellidos: true, foto: true } },
      evaluador: { select: { id: true, nombre: true, apellidos: true } },
    },
  });
  return NextResponse.json({ evaluacion: ev }, { status: 201 });
}));
