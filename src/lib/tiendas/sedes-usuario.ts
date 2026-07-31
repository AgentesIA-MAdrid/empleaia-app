/**
 * Sedes de una persona (ticket 73).
 *
 * Hasta ahora el alcance de un coordinador salía de `User.tiendaId`, una sola
 * sede. El cliente los organiza al contrario: una coordinadora lleva **varios**
 * puntos de venta y su equipo son las personas de esas tiendas, no una lista de
 * empleados colgada a mano.
 *
 * Sus sedes son las de `UsuarioSede` (el N:N que ya se rellena en la ficha del
 * empleado) más la principal de la ficha, que sigue existiendo y no siempre
 * está duplicada en la tabla N:N.
 *
 * Solo sedes **activas**: en producción hay tiendas de mentira desactivadas
 * ("BAJA", "VACACIONES") que se usan como cajón para el cuadrante, y no son
 * puntos de venta que nadie coordine.
 *
 * Recibe el cliente Prisma del tenant como dependencia (nunca fetch interno
 * entre rutas — ver AGENTS.md), así que se puede probar con un doble.
 */

import type { PrismaClient } from "@/generated/prisma-tenant/client";

type PrismaSedes = Pick<PrismaClient, "usuarioSede" | "tienda">;

export async function sedesDelUsuario(
  prisma: PrismaSedes,
  opts: { userId: string; tiendaId: string | null },
): Promise<string[]> {
  const asignadas = await prisma.usuarioSede.findMany({
    where: { userId: opts.userId, tienda: { activa: true } },
    select: { tiendaId: true, principal: true },
    orderBy: [{ principal: "desc" }, { createdAt: "asc" }],
  });

  const ids = asignadas.map((a) => a.tiendaId);

  // La sede principal de la ficha cuenta aunque no esté en el N:N (los
  // empleados dados de alta antes del multi-sede solo tienen esta).
  if (opts.tiendaId && !ids.includes(opts.tiendaId)) {
    const principal = await prisma.tienda.findFirst({
      where: { id: opts.tiendaId, activa: true },
      select: { id: true },
    });
    if (principal) ids.unshift(principal.id);
  }

  return [...new Set(ids)];
}
