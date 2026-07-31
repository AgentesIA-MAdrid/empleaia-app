/**
 * Lectura y saneado de los grupos de objetivos — compartido por
 * `/api/objetivos-venta/grupos` y `/api/objetivos-venta/grupos/[id]`.
 *
 * Convención del repo: nada de fetch interno entre rutas del mismo proceso; la
 * lógica compartida vive en `src/lib/` y recibe el cliente Prisma inyectado
 * (ver `src/lib/cierre-turno/ventas-queries.ts`).
 */

import type { PrismaClient } from "@/generated/prisma-tenant/client";

/** Lo que se lee de un grupo en todas las rutas que lo devuelven. */
export const CAMPOS_GRUPO = {
  id: true,
  nombre: true,
  activo: true,
  orden: true,
  miembros: { select: { userId: true, tiendaId: true } },
} as const;

/** Grupo tal y como lo espera la pantalla: los miembros en dos listas de ids. */
export function serializarGrupo(g: {
  id: string;
  nombre: string;
  activo: boolean;
  orden: number;
  miembros: { userId: string | null; tiendaId: string | null }[];
}) {
  return {
    id: g.id,
    nombre: g.nombre,
    activo: g.activo,
    orden: g.orden,
    userIds: g.miembros.map((m) => m.userId).filter((x): x is string => Boolean(x)),
    tiendaIds: g.miembros.map((m) => m.tiendaId).filter((x): x is string => Boolean(x)),
  };
}

/**
 * Miembros que se pueden guardar: los ids que existen de verdad, sin
 * repetidos. Un id inventado (o de alguien dado de baja entre que se abrió la
 * pantalla y se guardó) no se mete en silencio: se cuenta en `descartados`
 * para poder decir cuántos se han quedado fuera.
 */
export async function miembrosValidos(
  prisma: PrismaClient,
  userIds: unknown,
  tiendaIds: unknown,
): Promise<{ userIds: string[]; tiendaIds: string[]; descartados: number }> {
  const pedidosUsuarios = Array.isArray(userIds)
    ? [...new Set(userIds.filter((x): x is string => typeof x === "string" && Boolean(x)))]
    : [];
  const pedidasSedes = Array.isArray(tiendaIds)
    ? [...new Set(tiendaIds.filter((x): x is string => typeof x === "string" && Boolean(x)))]
    : [];

  const [usuarios, sedes] = await Promise.all([
    pedidosUsuarios.length > 0
      ? prisma.user.findMany({ where: { id: { in: pedidosUsuarios } }, select: { id: true } })
      : Promise.resolve([] as { id: string }[]),
    pedidasSedes.length > 0
      ? prisma.tienda.findMany({ where: { id: { in: pedidasSedes } }, select: { id: true } })
      : Promise.resolve([] as { id: string }[]),
  ]);

  return {
    userIds: usuarios.map((u) => u.id),
    tiendaIds: sedes.map((t) => t.id),
    descartados: pedidosUsuarios.length - usuarios.length + (pedidasSedes.length - sedes.length),
  };
}
