/**
 * GET /api/articulos-venta — catálogo de artículos y servicios que se venden.
 *
 * Es la base de la tabla del paso 1 del cierre. El catálogo se sube desde Excel
 * o CSV (ver `importar/`) y se retoca aquí; mientras esté vacío, el asistente
 * avisa de que falta en vez de mostrar una tabla sin filas.
 *
 * PATCH /api/articulos-venta — retoca un artículo (nombre, categoría, orden,
 * precio) o lo desactiva. Solo administración. Nunca se borra: las ventas ya
 * registradas con él tienen que seguir siendo legibles.
 *
 * El precio es opcional y solo se usa si el cliente enciende los precios
 * (`ventasPreciosActivos`); el GET devuelve ese interruptor para que la
 * pantalla sepa si tiene sentido mostrar la columna.
 */

import { auth } from "@/lib/auth";
import { prismaApp as prisma } from "@/lib/prisma";
import { NextResponse, type NextRequest } from "next/server";

import { withTenant } from "@/lib/tenant/with-tenant";
import { withFeature } from "@/lib/feature-guard/with-feature";
import { parsearPrecio } from "@/lib/cierre-turno/catalogo";

export const GET = withTenant(
  withFeature("cierre_turno", async (req: NextRequest) => {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    // ?todos=1 → también los desactivados, para la pantalla de administración.
    const url = new URL(req.url);
    const todos = url.searchParams.get("todos") === "1";

    const [articulos, cfg] = await Promise.all([
      prisma.articuloVenta.findMany({
        ...(todos ? {} : { where: { activo: true } }),
        select: { id: true, nombre: true, categoria: true, orden: true, activo: true, precio: true },
        orderBy: [{ orden: "asc" }, { nombre: "asc" }],
      }),
      prisma.configuracionEmpresa.findUnique({
        where: { id: "singleton" },
        select: { ventasPreciosActivos: true, cierreTurnoEnRodaje: true },
      }),
    ]);

    return NextResponse.json({
      // El precio viaja como número (o null): Decimal serializado a string
      // obligaría a parsearlo en cada pantalla.
      articulos: articulos.map((a) => ({ ...a, precio: a.precio === null ? null : Number(a.precio) })),
      catalogoVacio: articulos.filter((a) => a.activo).length === 0,
      preciosActivos: cfg?.ventasPreciosActivos ?? false,
      // Sin fila de configuración se asume rodaje (lado prudente).
      enRodaje: cfg?.cierreTurnoEnRodaje ?? true,
    });
  }),
);

export const PATCH = withTenant(
  withFeature("cierre_turno", async (req: NextRequest) => {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rol = (session.user as any).rol as string;
    if (rol !== "OWNER") {
      return NextResponse.json(
        { error: "Solo un administrador puede cambiar el catálogo de ventas." },
        { status: 403 },
      );
    }

    const body = (await req.json().catch(() => null)) as {
      id?: unknown;
      nombre?: unknown;
      categoria?: unknown;
      orden?: unknown;
      activo?: unknown;
      precio?: unknown;
    } | null;
    if (!body || typeof body.id !== "string") {
      return NextResponse.json({ error: "Datos no válidos" }, { status: 400 });
    }

    const data: {
      nombre?: string;
      categoria?: string | null;
      orden?: number;
      activo?: boolean;
      precio?: number | null;
    } = {};
    if (typeof body.nombre === "string") {
      const n = body.nombre.trim().replace(/\s+/g, " ");
      if (n.length < 2) {
        return NextResponse.json({ error: "El nombre es demasiado corto." }, { status: 400 });
      }
      data.nombre = n.slice(0, 120);
    }
    if (body.categoria !== undefined) {
      data.categoria =
        typeof body.categoria === "string" && body.categoria.trim()
          ? body.categoria.trim().slice(0, 80)
          : null;
    }
    if (typeof body.orden === "number" && Number.isInteger(body.orden) && body.orden >= 0) {
      data.orden = body.orden;
    }
    if (typeof body.activo === "boolean") data.activo = body.activo;
    // Vaciar el campo en la pantalla borra el precio (queda "sin precio"), no
    // lo pone a cero: cero es un artículo gratis, y no es lo mismo.
    if (body.precio !== undefined) {
      if (body.precio === null || body.precio === "") {
        data.precio = null;
      } else {
        const p = parsearPrecio(String(body.precio));
        if (p === null) {
          return NextResponse.json({ error: "El precio no es válido." }, { status: 400 });
        }
        data.precio = p;
      }
    }

    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: "No hay nada que cambiar." }, { status: 400 });
    }

    const actualizado = await prisma.articuloVenta.update({
      where: { id: body.id },
      data,
      select: { id: true, nombre: true, categoria: true, orden: true, activo: true, precio: true },
    });
    return NextResponse.json({
      ...actualizado,
      precio: actualizado.precio === null ? null : Number(actualizado.precio),
    });
  }),
);
