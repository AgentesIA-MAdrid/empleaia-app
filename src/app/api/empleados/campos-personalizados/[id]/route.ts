/**
 * DELETE /api/empleados/campos-personalizados/[id]
 *
 * Elimina una definición de campo personalizado del tenant (y en cascada
 * los valores guardados para cada empleado). Solo OWNER.
 */

import { auth } from "@/lib/auth";
import { prismaApp } from "@/lib/prisma";
import { Rol } from "@/generated/prisma-tenant/client";
import type { NextRequest } from "next/server";
import { withTenant } from "@/lib/tenant/with-tenant";

export const DELETE = withTenant(async (
  _req: NextRequest,
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
  const campo = await prismaApp.campoPersonalizado.findUnique({
    where: { id },
    select: { id: true },
  });
  if (!campo) {
    return Response.json({ error: "Campo no encontrado" }, { status: 404 });
  }
  await prismaApp.campoPersonalizado.delete({ where: { id } });
  return Response.json({ success: true });
});
