/**
 * GET  /api/organigrama       — devuelve árbol jerárquico de empleados.
 * PATCH /api/organigrama/[id] — asigna manager a un empleado (admin only).
 */

import { NextResponse } from "next/server";
import { prismaApp } from "@/lib/prisma";
import { withTenant } from "@/lib/tenant/with-tenant";
import { withFeature } from "@/lib/feature-guard/with-feature";
import { buildOrganigrama } from "@/lib/organigrama/build-tree";

export const GET = withTenant(withFeature("organigrama", async () => {
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
