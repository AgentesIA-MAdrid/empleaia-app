/**
 * En qué sedes puede operar hoy una persona (ticket 8c05f3e1, ampliado).
 *
 * Lo normal es que sean las suyas: la de su ficha más las que coordine. Pero un
 * **correturnos no tiene ninguna**, y aun así está trabajando en una tienda: le
 * toca cerrar su turno, contar la caja y, si es domingo, preparar el arqueo. Con
 * el criterio de "solo tus sedes" se quedaba fuera de todo con un "no tienes
 * sede asignada, habla con administración" que no arregla nada a las nueve de la
 * noche.
 *
 * La respuesta es la sede que él mismo confirma al empezar el cierre del día
 * (`CierreTurno.tiendaId`). Es una sola fuente de verdad —"dónde trabajo hoy"—
 * y vale para las dos pantallas: el cierre y el arqueo.
 *
 * No se comprueba que la sede confirmada sea "suya", a propósito: cubrir donde
 * no te toca es justo el caso que esto resuelve. Lo que sí se exige, donde se
 * confirma, es que la tienda exista y esté activa.
 */

import type { PrismaClient } from "@/generated/prisma-tenant/client";
import { diaMadrid } from "./core";
import { sedesDelUsuario } from "@/lib/tiendas/sedes-usuario";

export async function sedesOperables(
  prisma: PrismaClient,
  args: { userId: string; tiendaId: string | null },
): Promise<string[]> {
  const propias = await sedesDelUsuario(prisma, args);
  if (propias.length > 0) return propias;

  // Sin sedes propias: la que haya confirmado hoy al abrir su cierre.
  const hoy = await prisma.cierreTurno.findUnique({
    where: {
      userId_fecha: { userId: args.userId, fecha: new Date(`${diaMadrid()}T00:00:00Z`) },
    },
    select: { tiendaId: true },
  });
  return hoy?.tiendaId ? [hoy.tiendaId] : [];
}
