/**
 * /api/empleados/campos-personalizados
 *
 * Campos personalizados de la ficha del empleado. La definición es del
 * tenant (aplica a todos los empleados); el valor se guarda por empleado
 * en `/api/empleados/[id]/campos-personalizados`.
 *
 * GET  → lista las definiciones activas (OWNER / MANAGER).
 * POST → crea una nueva definición (solo OWNER).
 *
 * Datos con `prismaApp` (tenant). Envuelto en `withTenant` (AGENTS.md).
 */

import { auth } from "@/lib/auth";
import { prismaApp } from "@/lib/prisma";
import { Rol } from "@/generated/prisma-tenant/client";
import type { NextRequest } from "next/server";
import { withTenant } from "@/lib/tenant/with-tenant";
import { slugCampo, TIPOS_CAMPO } from "@/lib/empleados/campos-personalizados";

export const GET = withTenant(async () => {
  const session = await auth();
  if (!session?.user) {
    return Response.json({ error: "No autorizado" }, { status: 401 });
  }
  const rol = (session.user as { rol: Rol }).rol;
  if (rol !== Rol.OWNER && rol !== Rol.MANAGER) {
    return Response.json({ error: "No autorizado" }, { status: 403 });
  }

  const campos = await prismaApp.campoPersonalizado.findMany({
    where: { activo: true },
    select: { id: true, clave: true, etiqueta: true, tipo: true, orden: true },
    orderBy: [{ orden: "asc" }, { createdAt: "asc" }],
  });
  return Response.json({ campos });
});

export const POST = withTenant(async (req: NextRequest) => {
  const session = await auth();
  if (!session?.user) {
    return Response.json({ error: "No autorizado" }, { status: 401 });
  }
  const rol = (session.user as { rol: Rol }).rol;
  if (rol !== Rol.OWNER) {
    return Response.json({ error: "No autorizado" }, { status: 403 });
  }

  const body = (await req.json()) as { etiqueta?: string; tipo?: string };
  const etiqueta = typeof body.etiqueta === "string" ? body.etiqueta.trim() : "";
  if (!etiqueta) {
    return Response.json({ error: "La etiqueta es obligatoria" }, { status: 400 });
  }
  if (etiqueta.length > 60) {
    return Response.json({ error: "La etiqueta es demasiado larga (máx 60)" }, { status: 400 });
  }
  const tipo = TIPOS_CAMPO.includes(body.tipo as (typeof TIPOS_CAMPO)[number])
    ? (body.tipo as string)
    : "texto";

  // Clave estable a partir de la etiqueta, con sufijo si ya existe.
  const base = slugCampo(etiqueta) || "campo";
  let clave = base;
  for (let i = 2; await prismaApp.campoPersonalizado.count({ where: { clave } }); i++) {
    clave = `${base}_${i}`;
  }

  const max = await prismaApp.campoPersonalizado.aggregate({ _max: { orden: true } });
  const orden = (max._max.orden ?? -1) + 1;

  const campo = await prismaApp.campoPersonalizado.create({
    data: { clave, etiqueta, tipo, orden },
    select: { id: true, clave: true, etiqueta: true, tipo: true, orden: true },
  });
  return Response.json({ campo }, { status: 201 });
});
