import { auth } from "@/lib/auth";
import { prismaApp as prisma } from "@/lib/prisma";
import { Rol } from "@/generated/prisma-tenant/client";
import type { NextRequest } from "next/server";

import { withTenant } from "@/lib/tenant/with-tenant";
import { currentTenant } from "@/lib/tenant/context";
import { getLimit } from "@/lib/tenant/features";
import { HttpError, wrapHttpErrors } from "@/lib/feature-guard/http-error";
import { geocodeAddress } from "@/lib/tiendas/geocode";
export const GET = withTenant(async () => {
  try {
    const session = await auth();
    if (!session?.user) {
      return Response.json({ error: "No autorizado" }, { status: 401 });
    }

    const tiendas = await prisma.tienda.findMany({
      orderBy: { nombre: "asc" },
      // Cuenta solo empleados no anonimizados: tras el borrado RGPD
      // (anonimizadoAt) el empleado conserva su fila pero sale de los
      // listados, así que tampoco debe contar para la sede.
      include: {
        _count: { select: { empleados: { where: { anonimizadoAt: null } } } },
        // Responsable de la sede (dato informativo, ver schema).
        manager: { select: { id: true, nombre: true, apellidos: true } },
      },
    });

    return Response.json({ tiendas });
  } catch (error) {
    console.error("GET /api/tiendas error:", error);
    return Response.json({ error: "Error interno del servidor" }, { status: 500 });
  }
});

/**
 * POST /api/tiendas — crea una tienda en el tenant actual.
 *
 * Plan Fase 5 §5.1: feature `max_tiendas` (limit). Race-safe con
 * advisory lock siguiendo el mismo patrón que `max_employees` (§5.5)
 * para que dos POSTs concurrentes no sobrepasen el límite.
 *
 * `multi_tienda` (boolean) NO es una restricción independiente — el
 * plan starter expone max_tiendas=1, plan pro max_tiendas=N. La
 * presencia de la feature multi_tienda en el catálogo es informativa
 * (UI puede mostrar/ocultar tabs); el control real es max_tiendas.
 */
export const POST = withTenant(
  wrapHttpErrors(async (request: NextRequest) => {
    const session = await auth();
    if (!session?.user) {
      return Response.json({ error: "No autorizado" }, { status: 401 });
    }

    const userRol = (session.user as any).rol as Rol;
    if (userRol !== Rol.OWNER) {
      return Response.json({ error: "No autorizado" }, { status: 403 });
    }

    const body = await request.json();
    const {
      nombre,
      direccion,
      ciudad,
      codigoPostal,
      telefono,
      email,
      latitud,
      longitud,
      radio = 200,
      color = "#6366f1",
      managerId,
      esOficina = false,
    } = body as {
      nombre: string;
      direccion: string;
      ciudad: string;
      codigoPostal?: string;
      telefono?: string;
      email?: string;
      latitud?: number;
      longitud?: number;
      radio?: number;
      color?: string;
      managerId?: string | null;
      esOficina?: boolean;
    };

    if (!nombre || !direccion || !ciudad) {
      return Response.json(
        { error: "Faltan campos obligatorios: nombre, direccion, ciudad" },
        { status: 400 }
      );
    }

    // Geocodifica automáticamente si el cliente no fijó coordenadas a mano.
    let lat = latitud;
    let lon = longitud;
    if (lat == null || lon == null) {
      const geo = await geocodeAddress(direccion, ciudad, codigoPostal);
      if (geo) {
        lat = geo.latitud;
        lon = geo.longitud;
      }
    }

    const { tenantId } = currentTenant();

    const tienda = await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`,
        `tenant:max_tiendas:${tenantId}`,
      );

      const max = getLimit("max_tiendas");
      const count = await tx.tienda.count({ where: { activa: true } });
      if (max !== null && count >= max) {
        throw new HttpError(402, {
          error: "limit_reached",
          feature_key: "max_tiendas",
          current: count,
          max,
          upgrade_url: "/admin/configuracion/facturacion?upgrade=max_tiendas",
        });
      }

      // Solo una sede puede ser la oficina: al marcarla, se desmarca el resto.
      if (esOficina) {
        await tx.tienda.updateMany({
          where: { esOficina: true },
          data: { esOficina: false },
        });
      }

      return tx.tienda.create({
        data: {
          nombre,
          direccion,
          ciudad,
          codigoPostal,
          telefono,
          email,
          latitud: lat,
          longitud: lon,
          radio,
          color,
          // Responsable informativo: cadena vacía → sin responsable.
          managerId: managerId || null,
          esOficina: Boolean(esOficina),
        },
      });
    });

    return Response.json(tienda, { status: 201 });
  })
);
