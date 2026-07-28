/**
 * GET  /api/solicitudes-fichaje  — lista solicitudes.
 *   ?vista=mias (default)  → las del propio usuario.
 *   ?vista=aprobaciones    → las que el usuario puede resolver
 *                            (OWNER: todas; MANAGER: su tienda; + las
 *                            asignadas a él como coordinador, cualquier rol).
 *   ?estado=PENDIENTE|...   filtro opcional.
 *
 * POST /api/solicitudes-fichaje — el empleado crea una solicitud propia
 *   (olvido de fichaje o corrección de hora de uno existente).
 */

import { auth } from "@/lib/auth";
import { prismaApp as prisma } from "@/lib/prisma";
import { Rol } from "@/generated/prisma-tenant/client";
import type { EstadoSolicitudFichaje } from "@/generated/prisma-tenant/client";
import type { NextRequest } from "next/server";

import { withTenant } from "@/lib/tenant/with-tenant";
import { normalizarCrearSolicitud } from "@/lib/solicitudes-fichaje/core";
import { notifySolicitudCreada } from "@/lib/solicitudes-fichaje/notify";
import { calcularDistancia } from "@/lib/utils";

const ESTADOS = ["PENDIENTE", "APROBADA", "RECHAZADA", "CANCELADA"];

const includeSolicitud = {
  solicitante: {
    select: { id: true, nombre: true, apellidos: true, email: true, tiendaId: true },
  },
  aprobador: { select: { id: true, nombre: true, apellidos: true } },
} as const;

export const GET = withTenant(async (request: NextRequest) => {
  try {
    const session = await auth();
    if (!session?.user) {
      return Response.json({ error: "No autorizado" }, { status: 401 });
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const userRol = (session.user as any).rol as Rol;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const userTiendaId = (session.user as any).tiendaId as string | null;
    const userId = session.user.id!;

    const { searchParams } = request.nextUrl;
    const vista = searchParams.get("vista") ?? "mias";
    const estado = searchParams.get("estado");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: any = {};

    if (vista === "aprobaciones") {
      if (userRol === Rol.OWNER) {
        // todas
      } else if (userRol === Rol.MANAGER) {
        where.OR = [
          { solicitante: { tiendaId: userTiendaId } },
          { aprobadorId: userId },
        ];
      } else {
        // EMPLEADO que sea coordinador designado de alguien.
        where.aprobadorId = userId;
      }
    } else {
      where.solicitanteId = userId;
    }

    if (estado && ESTADOS.includes(estado)) {
      where.estado = estado as EstadoSolicitudFichaje;
    }

    const solicitudes = await prisma.solicitudFichaje.findMany({
      where,
      include: includeSolicitud,
      orderBy: { createdAt: "desc" },
    });

    return Response.json(solicitudes);
  } catch (error) {
    console.error("GET /api/solicitudes-fichaje error:", error);
    return Response.json({ error: "Error interno del servidor" }, { status: 500 });
  }
});

export const POST = withTenant(async (request: NextRequest) => {
  try {
    const session = await auth();
    if (!session?.user) {
      return Response.json({ error: "No autorizado" }, { status: 401 });
    }
    const userId = session.user.id!;

    const body = await request.json().catch(() => null);
    const norm = normalizarCrearSolicitud(body ?? {});
    if (!norm.ok) {
      return Response.json({ error: norm.error }, { status: 400 });
    }
    const { clase, tipo, fechaHora, motivo, fichajeId, latitud, longitud, distancia } = norm.data;

    // Solicitante: el propio usuario (con su tienda y coordinador).
    const solicitante = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, nombre: true, apellidos: true, email: true, tiendaId: true, managerId: true },
    });
    if (!solicitante) {
      return Response.json({ error: "Usuario no encontrado" }, { status: 404 });
    }

    // En corrección, el fichaje debe existir y ser del propio solicitante.
    if (clase === "correccion") {
      const fichaje = await prisma.fichaje.findUnique({
        where: { id: fichajeId! },
        select: { id: true, userId: true },
      });
      if (!fichaje || fichaje.userId !== userId) {
        return Response.json({ error: "Fichaje a corregir no válido" }, { status: 400 });
      }
    }

    // En "fuera_sede" la distancia se recalcula aquí con las coordenadas de
    // la sede: la que envíe el cliente no es auditable (ver /api/fichajes).
    let distanciaReal = distancia;
    if (clase === "fuera_sede" && latitud != null && longitud != null) {
      const tienda = solicitante.tiendaId
        ? await prisma.tienda.findUnique({
            where: { id: solicitante.tiendaId },
            select: { latitud: true, longitud: true },
          })
        : null;
      distanciaReal =
        tienda?.latitud != null && tienda?.longitud != null
          ? Math.round(calcularDistancia(latitud, longitud, tienda.latitud, tienda.longitud))
          : null;
    }

    const creada = await prisma.solicitudFichaje.create({
      data: {
        solicitanteId: userId,
        aprobadorId: solicitante.managerId ?? null,
        clase,
        tipo,
        fichajeId,
        fechaHora,
        motivo,
        estado: "PENDIENTE",
        latitud,
        longitud,
        distancia: distanciaReal,
      },
      include: includeSolicitud,
    });

    // Best-effort: avisa a coordinador + OWNERs/MANAGERs. No bloquea.
    void notifySolicitudCreada({
      id: creada.id,
      clase: creada.clase,
      tipo: creada.tipo,
      fechaHora: creada.fechaHora,
      motivo: creada.motivo,
      estado: creada.estado,
      aprobadorId: creada.aprobadorId,
      solicitante: creada.solicitante,
    });

    return Response.json(creada, { status: 201 });
  } catch (error) {
    console.error("POST /api/solicitudes-fichaje error:", error);
    return Response.json({ error: "Error interno del servidor" }, { status: 500 });
  }
});
