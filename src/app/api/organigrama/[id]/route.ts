import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { Rol } from "@/generated/prisma-tenant/client";
import { prismaApp } from "@/lib/prisma";
import { withTenant } from "@/lib/tenant/with-tenant";
import { withFeature } from "@/lib/feature-guard/with-feature";

const schema = z.object({ managerId: z.string().nullable() });

export const PATCH = withTenant(withFeature("organigrama", async (
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) => {
  const session = await auth();
  const user = session?.user as { rol?: Rol | string } | undefined;
  // Reasignar manager en el organigrama es gestión: solo el Administrador.
  if (user?.rol !== Rol.OWNER) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }
  const { id } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "managerId requerido" }, { status: 400 });
  }
  // Anti-bucle: un empleado no puede ser manager de sí mismo.
  if (parsed.data.managerId === id) {
    return NextResponse.json(
      { error: "Un empleado no puede ser manager de sí mismo" },
      { status: 400 },
    );
  }

  const updated = await prismaApp.user.update({
    where: { id },
    data: { managerId: parsed.data.managerId },
    select: { id: true, managerId: true },
  });
  return NextResponse.json({ user: updated });
}));
