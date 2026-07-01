/**
 * /api/empleados/[id]/campos-personalizados
 *
 * Valores de los campos personalizados para un empleado concreto.
 *
 * GET → definiciones activas + valores actuales del empleado
 *       (OWNER / MANAGER; para pintar la ficha).
 * PUT → guarda los valores del empleado (solo OWNER). Body:
 *       `{ valores: { [campoId]: string } }`. Valor "" elimina el valor.
 *
 * Datos con `prismaApp` (tenant). Envuelto en `withTenant`.
 */

import { auth } from "@/lib/auth";
import { prismaApp } from "@/lib/prisma";
import { Rol } from "@/generated/prisma-tenant/client";
import type { NextRequest } from "next/server";
import { withTenant } from "@/lib/tenant/with-tenant";

export const GET = withTenant(async (
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) => {
  const session = await auth();
  if (!session?.user) {
    return Response.json({ error: "No autorizado" }, { status: 401 });
  }
  const rol = (session.user as { rol: Rol }).rol;
  if (rol !== Rol.OWNER && rol !== Rol.MANAGER) {
    return Response.json({ error: "No autorizado" }, { status: 403 });
  }

  const { id } = await params;
  const [campos, valores] = await Promise.all([
    prismaApp.campoPersonalizado.findMany({
      where: { activo: true },
      select: { id: true, clave: true, etiqueta: true, tipo: true, orden: true },
      orderBy: [{ orden: "asc" }, { createdAt: "asc" }],
    }),
    prismaApp.valorCampoEmpleado.findMany({
      where: { userId: id },
      select: { campoId: true, valor: true },
    }),
  ]);

  const valoresMap: Record<string, string> = {};
  for (const v of valores) valoresMap[v.campoId] = v.valor;

  return Response.json({ campos, valores: valoresMap });
});

export const PUT = withTenant(async (
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) => {
  const session = await auth();
  if (!session?.user) {
    return Response.json({ error: "No autorizado" }, { status: 401 });
  }
  const rol = (session.user as { rol: Rol }).rol;
  if (rol !== Rol.OWNER) {
    return Response.json({ error: "No autorizado" }, { status: 403 });
  }

  const { id } = await params;
  const empleado = await prismaApp.user.findUnique({
    where: { id },
    select: { id: true },
  });
  if (!empleado) {
    return Response.json({ error: "Empleado no encontrado" }, { status: 404 });
  }

  const body = (await req.json()) as { valores?: Record<string, unknown> };
  const valores = body.valores ?? {};
  if (typeof valores !== "object" || Array.isArray(valores)) {
    return Response.json({ error: "valores inválido" }, { status: 400 });
  }

  // Solo se aceptan campos que existan como definición activa.
  const definiciones = await prismaApp.campoPersonalizado.findMany({
    where: { activo: true },
    select: { id: true },
  });
  const validos = new Set(definiciones.map((d) => d.id));

  await prismaApp.$transaction(async (tx) => {
    for (const [campoId, raw] of Object.entries(valores)) {
      if (!validos.has(campoId)) continue;
      const valor = typeof raw === "string" ? raw.trim() : String(raw ?? "").trim();
      if (valor === "") {
        // Vacío → borrar el valor si existía.
        await tx.valorCampoEmpleado.deleteMany({ where: { userId: id, campoId } });
        continue;
      }
      await tx.valorCampoEmpleado.upsert({
        where: { userId_campoId: { userId: id, campoId } },
        create: { userId: id, campoId, valor },
        update: { valor },
      });
    }
  });

  return Response.json({ success: true });
});
