/**
 * DELETE /api/face/template/[userId] — admin borra plantilla biométrica
 * de un usuario. El usuario puede borrar la suya propia. Audit log.
 */

import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { Rol } from "@/generated/prisma-tenant/client";
import { prismaApp } from "@/lib/prisma";
import { withTenant } from "@/lib/tenant/with-tenant";

export const DELETE = withTenant(async (
  _req: NextRequest,
  { params }: { params: Promise<{ userId: string }> },
) => {
  const session = await auth();
  const me = session?.user as { id?: string; rol?: Rol | string } | undefined;
  if (!me?.id) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const { userId } = await params;

  const isSelf = userId === me.id;
  // Borrar la plantilla biométrica de un tercero es gestión: solo el
  // Administrador (OWNER). Cualquiera puede borrar la suya (RGPD).
  const isAdmin = me.rol === Rol.OWNER;
  if (!isSelf && !isAdmin) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  await prismaApp.faceTemplate.deleteMany({ where: { userId } });
  return NextResponse.json({ ok: true });
});
