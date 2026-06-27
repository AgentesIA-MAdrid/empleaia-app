/**
 * /api/denuncias
 *
 *   POST  → crear denuncia (cualquier usuario logueado, o anónimo via flag)
 *   GET   → listar denuncias (solo OWNER/MANAGER y el usuario asignado)
 *
 * Reglas:
 *   - Si `esAnonima=true`: NO se persiste informanteUserId/email/nombre.
 *     Se devuelve `accessToken` plain UNA SOLA VEZ para que el informante
 *     consulte su denuncia después.
 *   - Listado: OWNER/MANAGER ve todo; un instructor solo lo asignado a él.
 *   - El campo `descripcion` se guarda tal cual; en UI se muestra como
 *     texto plano (no markdown) por seguridad.
 */

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { Rol } from "@/generated/prisma-tenant/client";
import { prismaApp } from "@/lib/prisma";
import { withTenant } from "@/lib/tenant/with-tenant";
import { withFeature } from "@/lib/feature-guard/with-feature";
import { generateAccessToken } from "@/lib/denuncias/access-token";

const CATEGORIAS = [
  "acoso_laboral",
  "acoso_sexual",
  "discriminacion",
  "fraude",
  "corrupcion",
  "incumplimiento_normativo",
  "proteccion_datos",
  "seguridad_salud",
  "otro",
] as const;

const createSchema = z
  .object({
    asunto: z.string().min(5).max(200),
    categoria: z.enum(CATEGORIAS),
    descripcion: z.string().min(20).max(5000),
    fechaIncidente: z.string().datetime().optional(),
    esAnonima: z.boolean().default(false),
    // Solo si esAnonima=false:
    informanteEmail: z.string().email().optional(),
    informanteNombre: z.string().min(2).max(120).optional(),
    informanteTelefono: z.string().max(40).optional(),
  })
  .refine(
    (d) =>
      d.esAnonima || d.informanteEmail || d.informanteNombre,
    {
      message:
        "Si la denuncia no es anónima, debes facilitar al menos email o nombre.",
    },
  );

export const POST = withTenant(withFeature("canal_denuncias", async (req: NextRequest) => {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id ?? null;

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

  // Si hay sesión y NO se eligió anónima, vinculamos el userId.
  // Si esAnonima=true, NO guardamos identidad — ni siquiera si está logueado.
  const informanteUserId = data.esAnonima ? null : userId;

  // Token de acceso para el informante (anónimo o no, lo damos por si quiere
  // seguir el caso sin login). El plain solo se devuelve UNA vez.
  const { plain, hash } = generateAccessToken();

  const denuncia = await prismaApp.denuncia.create({
    data: {
      asunto: data.asunto,
      categoria: data.categoria,
      descripcion: data.descripcion,
      fechaIncidente: data.fechaIncidente ? new Date(data.fechaIncidente) : null,
      esAnonima: data.esAnonima,
      informanteEmail: data.esAnonima ? null : data.informanteEmail ?? null,
      informanteNombre: data.esAnonima ? null : data.informanteNombre ?? null,
      informanteTelefono: data.esAnonima
        ? null
        : data.informanteTelefono ?? null,
      informanteUserId,
      accessTokenHash: hash,
    },
    select: { id: true, createdAt: true, esAnonima: true },
  });

  return NextResponse.json(
    {
      id: denuncia.id,
      createdAt: denuncia.createdAt,
      // El plain token solo se devuelve aquí. NO se persiste plain.
      // El informante debe guardarlo para volver a consultar el caso.
      accessToken: plain,
    },
    { status: 201 },
  );
}));

export const GET = withTenant(withFeature("canal_denuncias", async (req: NextRequest) => {
  const session = await auth();
  const user = session?.user as
    | { id?: string; rol?: Rol | string }
    | undefined;
  if (!user || !user.id) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }
  const isAdmin = user.rol === Rol.OWNER || user.rol === Rol.MANAGER;

  const url = req.nextUrl;
  const estado = url.searchParams.get("estado");
  const categoria = url.searchParams.get("categoria");
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "50", 10), 200);

  const where: Record<string, unknown> = {};
  if (!isAdmin) {
    // No-admin solo ve lo asignado a sí mismo.
    where.asignadoUserId = user.id;
  }
  if (estado) where.estado = estado;
  if (categoria) where.categoria = categoria;

  const items = await prismaApp.denuncia.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      asunto: true,
      categoria: true,
      estado: true,
      esAnonima: true,
      informanteNombre: true,
      asignadoUserId: true,
      createdAt: true,
      acuseReciboAt: true,
      resolucionAt: true,
    },
  });

  return NextResponse.json({ items, total: items.length });
}));
