/**
 * PUT /api/articulos-venta/orden — reordena el catálogo de artículos y
 * servicios. Solo administración.
 *
 * El orden del catálogo es el orden en el que el comercial ve la tabla del
 * paso 1 del cierre, y el de los objetivos de venta. Hasta ahora solo se fijaba
 * al darlos de alta (al final de la lista) o al importar la hoja (el orden de
 * las filas): quien montaba el catálogo a mano no tenía forma de recolocarlo.
 *
 * Llega la lista completa de ids en el orden deseado y se reescribe el campo
 * `orden` de golpe (0..n-1) dentro de una transacción. Mandar la lista entera
 * —y no "este artículo a la posición 3"— evita el estado en el que dos
 * artículos comparten posición y la tabla salta de sitio entre recargas, que es
 * justo lo que hay que arreglar aquí.
 */

import { auth } from "@/lib/auth";
import { prismaApp as prisma } from "@/lib/prisma";
import { NextResponse, type NextRequest } from "next/server";

import { withTenant } from "@/lib/tenant/with-tenant";
import { withFeature } from "@/lib/feature-guard/with-feature";
import { validarOrdenCatalogo } from "@/lib/cierre-turno/catalogo";

export const PUT = withTenant(
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

    const body = (await req.json().catch(() => null)) as { ids?: unknown } | null;
    if (!body) return NextResponse.json({ error: "Datos no válidos" }, { status: 400 });

    // Leer el catálogo y reescribir el orden en la misma transacción: entre
    // comprobar que la lista es la que hay y guardarla no puede colarse otra
    // pestaña añadiendo un artículo.
    const resultado = await prisma.$transaction(async (tx) => {
      const previos = await tx.articuloVenta.findMany({ select: { id: true, orden: true } });
      const validado = validarOrdenCatalogo(
        body.ids,
        previos.map((p) => p.id),
      );
      if (!validado.ok) return validado;

      const ordenActual = new Map(previos.map((p) => [p.id, p.orden]));
      for (let i = 0; i < validado.ids.length; i++) {
        const id = validado.ids[i];
        if (ordenActual.get(id) !== i) {
          await tx.articuloVenta.update({ where: { id }, data: { orden: i } });
        }
      }
      return { ok: true as const, ids: validado.ids };
    });

    if (!resultado.ok) {
      return NextResponse.json(
        { error: resultado.error },
        { status: resultado.estado === "desfasado" ? 409 : 400 },
      );
    }
    return NextResponse.json({ ok: true, ids: resultado.ids });
  }),
);
