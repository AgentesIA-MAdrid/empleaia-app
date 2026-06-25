/**
 * PATCH /api/solicitudes-fichaje/[id]
 *
 *   { estado: "CANCELADA" }              → solo el solicitante, si PENDIENTE.
 *   { estado: "APROBADA"|"RECHAZADA", respuesta? }
 *                                        → coordinador designado u OWNER/MANAGER
 *                                          con scope sobre el solicitante.
 *
 * Al APROBAR: crea (clase "olvido") o ajusta (clase "correccion") el Fichaje
 * como MANUAL, atribuido al resolutor, dentro de una transacción.
 */

import { auth } from "@/lib/auth";
import { prismaApp as prisma } from "@/lib/prisma";
import { Rol } from "@/generated/prisma-tenant/client";
import type { EstadoSolicitudFichaje } from "@/generated/prisma-tenant/client";
import type { NextRequest } from "next/server";

import { withTenant } from "@/lib/tenant/with-tenant";
import {
  puedeResolverSolicitud,
  buildFichajeCreate,
  buildFichajeUpdate,
  notaFichaje,
} from "@/lib/solicitudes-fichaje/core";
import { notifySolicitudResuelta } from "@/lib/solicitudes-fichaje/notify";

export const PATCH = withTenant(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    try {
      const session = await auth();
      if (!session?.user) {
        return Response.json({ error: "No autorizado" }, { status: 401 });
      }
      const { id } = await params;
      const userId = session.user.id!;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const userRol = (session.user as any).rol as Rol;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const userTiendaId = (session.user as any).tiendaId as string | null;

      const body = await request.json().catch(() => null);
      const estado = body?.estado as EstadoSolicitudFichaje | undefined;
      const respuesta: string | undefined =
        typeof body?.respuesta === "string" ? body.respuesta : undefined;

      const sol = await prisma.solicitudFichaje.findUnique({
        where: { id },
        include: {
          solicitante: {
            select: { id: true, nombre: true, apellidos: true, email: true, tiendaId: true },
          },
        },
      });
      if (!sol) {
        return Response.json({ error: "Solicitud no encontrada" }, { status: 404 });
      }
      if (sol.estado !== "PENDIENTE") {
        return Response.json({ error: "La solicitud ya está resuelta" }, { status: 409 });
      }

      // ── Cancelación por el propio solicitante ──
      if (estado === "CANCELADA") {
        if (sol.solicitanteId !== userId) {
          return Response.json({ error: "No autorizado" }, { status: 403 });
        }
        const updated = await prisma.solicitudFichaje.update({
          where: { id },
          data: { estado: "CANCELADA" },
        });
        return Response.json(updated);
      }

      // ── Resolución (aprobar / rechazar) ──
      if (estado !== "APROBADA" && estado !== "RECHAZADA") {
        return Response.json({ error: "Estado inválido" }, { status: 400 });
      }

      const autorizado =
        puedeResolverSolicitud(userRol, userTiendaId, sol.solicitante.tiendaId) ||
        sol.aprobadorId === userId;
      if (!autorizado) {
        return Response.json({ error: "No autorizado" }, { status: 403 });
      }
      // El solicitante no puede aprobar su propia solicitud.
      if (sol.solicitanteId === userId) {
        return Response.json(
          { error: "No puedes resolver tu propia solicitud" },
          { status: 403 },
        );
      }

      const resolverNombre =
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ((session.user as any).name as string) ?? "un responsable";

      const updated = await prisma.$transaction(async (tx) => {
        let fichajeResultanteId: string | null = null;

        if (estado === "APROBADA") {
          const nota = notaFichaje(sol.motivo, resolverNombre);
          if (sol.clase === "correccion" && sol.fichajeId) {
            const f = await tx.fichaje.update({
              where: { id: sol.fichajeId },
              data: buildFichajeUpdate({
                tipo: sol.tipo,
                fechaHora: sol.fechaHora,
                resolverId: userId,
                nota,
              }),
              select: { id: true },
            });
            fichajeResultanteId = f.id;
          } else {
            const f = await tx.fichaje.create({
              data: buildFichajeCreate({
                solicitanteId: sol.solicitanteId,
                tiendaId: sol.solicitante.tiendaId,
                tipo: sol.tipo,
                fechaHora: sol.fechaHora,
                resolverId: userId,
                nota,
              }),
              select: { id: true },
            });
            fichajeResultanteId = f.id;
          }
        }

        return tx.solicitudFichaje.update({
          where: { id },
          data: {
            estado,
            respuesta: respuesta ?? null,
            resueltaPorId: userId,
            resueltaEn: new Date(),
            fichajeResultanteId,
          },
          include: {
            solicitante: {
              select: { id: true, nombre: true, apellidos: true, email: true, tiendaId: true },
            },
            aprobador: { select: { id: true, nombre: true, apellidos: true } },
          },
        });
      });

      void notifySolicitudResuelta({
        id: updated.id,
        clase: updated.clase,
        tipo: updated.tipo,
        fechaHora: updated.fechaHora,
        motivo: updated.motivo,
        estado: updated.estado,
        respuesta: updated.respuesta,
        aprobadorId: updated.aprobadorId,
        solicitante: updated.solicitante,
      });

      return Response.json(updated);
    } catch (error) {
      console.error("PATCH /api/solicitudes-fichaje/[id] error:", error);
      return Response.json({ error: "Error interno del servidor" }, { status: 500 });
    }
  },
);
