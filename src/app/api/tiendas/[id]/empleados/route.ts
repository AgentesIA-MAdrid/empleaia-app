/**
 * GET/PUT /api/tiendas/[id]/empleados
 *
 * Gestión de la pertenencia empleado↔sede (N:N vía UsuarioSede).
 *
 * - GET: ids de los empleados asignados a la sede.
 * - PUT (OWNER): reemplaza el conjunto de miembros de la sede. Mantiene
 *   coherente `User.tiendaId` (sede PRINCIPAL): a quien no tenga sede
 *   principal, esta se la asigna; a quien se quita de su sede principal,
 *   se le reasigna otra de las suyas (o null).
 */

import { auth } from "@/lib/auth";
import { prismaApp as prisma } from "@/lib/prisma";
import { Rol } from "@/generated/prisma-tenant/client";
import { withTenant } from "@/lib/tenant/with-tenant";
import type { NextRequest } from "next/server";

export const GET = withTenant(async (_request: NextRequest,
  { params }: { params: Promise<{ id: string }> }) => {
  try {
    const session = await auth();
    if (!session?.user) return Response.json({ error: "No autorizado" }, { status: 401 });

    const { id } = await params;
    const miembros = await prisma.usuarioSede.findMany({
      where: { tiendaId: id },
      select: { userId: true, principal: true },
    });
    return Response.json({
      miembros: miembros.map((m) => m.userId),
      principales: miembros.filter((m) => m.principal).map((m) => m.userId),
    });
  } catch (error) {
    console.error("GET /api/tiendas/[id]/empleados error:", error);
    return Response.json({ error: "Error interno del servidor" }, { status: 500 });
  }
});

export const PUT = withTenant(async (request: NextRequest,
  { params }: { params: Promise<{ id: string }> }) => {
  try {
    const session = await auth();
    if (!session?.user) return Response.json({ error: "No autorizado" }, { status: 401 });
    const userRol = (session.user as { rol?: Rol }).rol;
    if (userRol !== Rol.OWNER) return Response.json({ error: "No autorizado" }, { status: 403 });

    const { id } = await params;
    const tienda = await prisma.tienda.findUnique({ where: { id }, select: { id: true } });
    if (!tienda) return Response.json({ error: "Sede no encontrada" }, { status: 404 });

    const body = await request.json().catch(() => null) as { userIds?: unknown } | null;
    const userIds = Array.isArray(body?.userIds)
      ? (body!.userIds as unknown[]).filter((x): x is string => typeof x === "string")
      : null;
    if (!userIds) return Response.json({ error: "Falta el array 'userIds'" }, { status: 400 });

    const current = await prisma.usuarioSede.findMany({
      where: { tiendaId: id },
      select: { userId: true },
    });
    const currentSet = new Set(current.map((c) => c.userId));
    const nextSet = new Set(userIds);
    const toAdd = userIds.filter((u) => !currentSet.has(u));
    const toRemove = [...currentSet].filter((u) => !nextSet.has(u));

    await prisma.$transaction(async (tx) => {
      // ── Quitar ──
      if (toRemove.length > 0) {
        await tx.usuarioSede.deleteMany({
          where: { tiendaId: id, userId: { in: toRemove } },
        });
        // A quien tenía esta sede como principal, reasignar otra (o null).
        const huérfanos = await tx.user.findMany({
          where: { id: { in: toRemove }, tiendaId: id },
          select: { id: true },
        });
        for (const u of huérfanos) {
          const otra = await tx.usuarioSede.findFirst({
            where: { userId: u.id },
            select: { id: true, tiendaId: true },
          });
          await tx.usuarioSede.updateMany({
            where: { userId: u.id },
            data: { principal: false },
          });
          if (otra) {
            await tx.usuarioSede.update({ where: { id: otra.id }, data: { principal: true } });
          }
          await tx.user.update({
            where: { id: u.id },
            data: { tiendaId: otra?.tiendaId ?? null },
          });
        }
      }

      // ── Añadir ──
      for (const userId of toAdd) {
        const user = await tx.user.findUnique({
          where: { id: userId },
          select: { tiendaId: true },
        });
        const esPrincipal = !user?.tiendaId;
        await tx.usuarioSede.create({
          data: { userId, tiendaId: id, principal: esPrincipal },
        });
        if (esPrincipal) {
          await tx.user.update({ where: { id: userId }, data: { tiendaId: id } });
        }
      }
    });

    return Response.json({ success: true, added: toAdd.length, removed: toRemove.length });
  } catch (error) {
    console.error("PUT /api/tiendas/[id]/empleados error:", error);
    return Response.json({ error: "Error interno del servidor" }, { status: 500 });
  }
});
