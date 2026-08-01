import { auth } from "@/lib/auth";
import { prismaApp as prisma } from "@/lib/prisma";
import { Rol } from "@/generated/prisma-tenant/client";
import type { NextRequest } from "next/server";

import { withTenant } from "@/lib/tenant/with-tenant";
import { geocodeAddress } from "@/lib/tiendas/geocode";
export const PUT = withTenant(async (request: NextRequest,
  { params }: { params: Promise<{ id: string }> }) => {
  try {
    const session = await auth();
    if (!session?.user) {
      return Response.json({ error: "No autorizado" }, { status: 401 });
    }

    const userRol = (session.user as any).rol as Rol;
    if (userRol !== Rol.OWNER) {
      return Response.json({ error: "No autorizado" }, { status: 403 });
    }

    const { id } = await params;

    const tienda = await prisma.tienda.findUnique({ where: { id } });
    if (!tienda) {
      return Response.json({ error: "Tienda no encontrada" }, { status: 404 });
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
      radio,
      color,
      activa,
      managerId,
      esOficina,
      sinEfectivo,
      arqueoDiaSemana,
      exigirFichajeEnSede,
    } = body as {
      nombre?: string;
      direccion?: string;
      ciudad?: string;
      codigoPostal?: string;
      telefono?: string;
      email?: string;
      latitud?: number;
      longitud?: number;
      radio?: number;
      color?: string;
      activa?: boolean;
      managerId?: string | null;
      esOficina?: boolean;
      sinEfectivo?: boolean;
      arqueoDiaSemana?: number;
      exigirFichajeEnSede?: boolean;
    };

    // Si cambia la dirección y NO se envían coordenadas explícitas,
    // re-geocodifica para mantener la ubicación al día.
    let lat = latitud;
    let lon = longitud;
    const cambiaDireccion =
      direccion !== undefined || ciudad !== undefined || codigoPostal !== undefined;
    if (cambiaDireccion && latitud === undefined && longitud === undefined) {
      const geo = await geocodeAddress(
        direccion ?? tienda.direccion,
        ciudad ?? tienda.ciudad,
        codigoPostal ?? tienda.codigoPostal,
      );
      if (geo) {
        lat = geo.latitud;
        lon = geo.longitud;
      }
    }

    // Solo una sede puede ser la oficina: al marcar esta, se desmarca el
    // resto. Ambas escrituras van en la misma transacción para no dejar el
    // tenant sin oficina si la actualización fallara tras el desmarcado.
    const updated = await prisma.$transaction(async (tx) => {
      if (esOficina === true) {
        await tx.tienda.updateMany({
          where: { esOficina: true, NOT: { id } },
          data: { esOficina: false },
        });
      }
      return tx.tienda.update({
        where: { id },
        data: {
          ...(nombre !== undefined && { nombre }),
          ...(direccion !== undefined && { direccion }),
          ...(ciudad !== undefined && { ciudad }),
          ...(codigoPostal !== undefined && { codigoPostal }),
          ...(telefono !== undefined && { telefono }),
          ...(email !== undefined && { email }),
          ...(lat !== undefined && { latitud: lat }),
          ...(lon !== undefined && { longitud: lon }),
          ...(radio !== undefined && { radio }),
          ...(color !== undefined && { color }),
          ...(activa !== undefined && { activa }),
          // Responsable informativo: ausente → no se toca; "" → se borra.
          ...(managerId !== undefined && { managerId: managerId || null }),
          ...(esOficina !== undefined && { esOficina: Boolean(esOficina) }),
          ...(sinEfectivo !== undefined && { sinEfectivo: Boolean(sinEfectivo) }),
          // Día del arqueo (1 = lunes … 7 = domingo). Un valor fuera de rango se
          // ignora en vez de dejar la sede sin arquear nunca.
          ...(typeof arqueoDiaSemana === "number" &&
            arqueoDiaSemana >= 1 &&
            arqueoDiaSemana <= 7 && { arqueoDiaSemana }),
          ...(exigirFichajeEnSede !== undefined && {
            exigirFichajeEnSede: Boolean(exigirFichajeEnSede),
          }),
        },
      });
    });

    return Response.json(updated);
  } catch (error) {
    console.error("PUT /api/tiendas/[id] error:", error);
    return Response.json({ error: "Error interno del servidor" }, { status: 500 });
  }
});

export const DELETE = withTenant(async (_request: NextRequest,
  { params }: { params: Promise<{ id: string }> }) => {
  try {
    const session = await auth();
    if (!session?.user) {
      return Response.json({ error: "No autorizado" }, { status: 401 });
    }

    const userRol = (session.user as any).rol as Rol;
    if (userRol !== Rol.OWNER) {
      return Response.json({ error: "No autorizado" }, { status: 403 });
    }

    const { id } = await params;

    const tienda = await prisma.tienda.findUnique({ where: { id } });
    if (!tienda) {
      return Response.json({ error: "Tienda no encontrada" }, { status: 404 });
    }

    // Soft delete
    const updated = await prisma.tienda.update({
      where: { id },
      data: { activa: false },
    });

    return Response.json(updated);
  } catch (error) {
    console.error("DELETE /api/tiendas/[id] error:", error);
    return Response.json({ error: "Error interno del servidor" }, { status: 500 });
  }
});
