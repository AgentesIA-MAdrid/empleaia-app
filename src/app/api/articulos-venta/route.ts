/**
 * GET /api/articulos-venta — catálogo de artículos y servicios que se venden.
 *
 * Es la base de la tabla del paso 1 del cierre. El catálogo lo sube el cliente
 * desde Excel (entrega 2) y se puede editar después; mientras esté vacío, el
 * asistente avisa de que falta en vez de mostrar una tabla sin filas.
 */

import { auth } from "@/lib/auth";
import { prismaApp as prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

import { withTenant } from "@/lib/tenant/with-tenant";
import { withFeature } from "@/lib/feature-guard/with-feature";

export const GET = withTenant(
  withFeature("cierre_turno", async () => {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const articulos = await prisma.articuloVenta.findMany({
      where: { activo: true },
      select: { id: true, nombre: true, categoria: true, orden: true },
      orderBy: [{ orden: "asc" }, { nombre: "asc" }],
    });

    return NextResponse.json({ articulos, catalogoVacio: articulos.length === 0 });
  }),
);
