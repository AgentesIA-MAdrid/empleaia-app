/**
 * GET  /api/organigrama       — devuelve árbol jerárquico de empleados.
 * PATCH /api/organigrama/[id] — asigna manager a un empleado (admin only).
 */

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prismaApp } from "@/lib/prisma";
import { withTenant } from "@/lib/tenant/with-tenant";
import { withFeature } from "@/lib/feature-guard/with-feature";
import { buildOrganigrama } from "@/lib/organigrama/build-tree";

export const GET = withTenant(withFeature("organigrama", async () => {
  // `withTenant` sólo cruza el JWT contra el host cuando hay JWT: sin
  // cookie deja pasar. El directorio de la plantilla (nombres, correos
  // corporativos, rol y jerarquía) no puede servirse a un anónimo.
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const empleados = await prismaApp.user.findMany({
    where: { activo: true },
    select: {
      id: true,
      nombre: true,
      apellidos: true,
      email: true,
      rol: true,
      foto: true,
      tiendaId: true,
      managerId: true,
    },
    orderBy: { nombre: "asc" },
  });
  const arbol = buildOrganigrama(empleados);
  return NextResponse.json({ arbol, total: empleados.length });
}));
