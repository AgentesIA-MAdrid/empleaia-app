/**
 * En qué sedes puede operar una persona (ticket 8c05f3e1, ampliado).
 *
 * Lo normal es que sean las suyas: la de su ficha más las que coordine. Pero un
 * **correturnos no tiene ninguna**, y aun así está trabajando en una tienda: le
 * toca cerrar su turno, contar la caja y, si es domingo, preparar el arqueo. Con
 * el criterio de "solo tus sedes" se quedaba fuera de todo con un "no tienes
 * sede asignada, habla con administración" que no arregla nada a las nueve de la
 * noche.
 *
 * Una respuesta es la sede que él mismo confirma al empezar el cierre del día
 * (`CierreTurno.tiendaId`): "dónde trabajo hoy", dicho por él.
 *
 * No basta, y por eso esto es una **unión, no una cascada** (ticket 225e527c):
 * el sobre del arqueo es de la SEDE, no del comercial que lo declaró, así que
 * tiene que verlo —y poder firmarlo— cualquiera que trabaje allí, aunque su
 * ficha diga otra tienda. Quien tiene sede propia pero esta semana cubre en otra
 * veía solo la suya y el sobre de la sede cubierta le quedaba invisible.
 *
 * Cuentan, todas a la vez:
 *  - Las sedes de su ficha y las que coordine (`sedesDelUsuario`).
 *  - La sede que haya confirmado en sus cierres de turno.
 *  - Las sedes de su **cuadrante publicado**.
 *  - Las sedes donde ha **fichado**.
 *
 * Las tres últimas se miran dentro de una ventana de tiempo (ver
 * `ventanasDeTrabajo`): haber cubierto un día en una tienda no da acceso a su
 * caja para siempre.
 *
 * Solo sedes **activas**, igual que `sedesDelUsuario`: en el cuadrante hay
 * tiendas de mentira ("BAJA", "VACACIONES") que se usan como cajón y no son
 * puntos de venta con caja que arquear.
 */

import type { PrismaClient } from "@/generated/prisma-tenant/client";
import { diaMadrid } from "./core";
import { rangoSemanaISO, semanaISO } from "./arqueos";
import { sedesDelUsuario } from "@/lib/tiendas/sedes-usuario";

const DIA_MS = 86_400_000;

/**
 * Cuánto se mira hacia atrás para decir "trabaja en esa sede". Ocho semanas: el
 * responsable no pasa cada semana a por los sobres y puede haber tres o cuatro
 * acumulados, así que la ventana tiene que cubrir de sobra ese retraso sin
 * convertirse en "cualquier tienda en la que estuviste alguna vez".
 */
export const DIAS_TRABAJO_RECIENTE = 56;

export interface RangoDias {
  desde: Date;
  hasta: Date;
}

/**
 * Los periodos en los que se mira dónde ha trabajado esta persona.
 *
 * Siempre está el reciente —las últimas ocho semanas y lo que queda de la
 * semana en curso, que incluye el cuadrante ya publicado de estos días—. A eso
 * se le suman los periodos que pida quien llama: la semana del arqueo que se
 * está mirando, que puede ser muy anterior ("tenía esa sede en su cuadrante ESA
 * semana"). Los que ya caen dentro del reciente no se repiten.
 */
export function ventanasDeTrabajo(hoy: Date, periodos: RangoDias[] = []): RangoDias[] {
  const reciente: RangoDias = {
    desde: new Date(hoy.getTime() - DIAS_TRABAJO_RECIENTE * DIA_MS),
    hasta: rangoSemanaISO(semanaISO(hoy)).hasta,
  };

  const vistos = new Set<string>();
  const extra: RangoDias[] = [];
  for (const p of periodos) {
    if (p.desde >= reciente.desde && p.hasta <= reciente.hasta) continue;
    const clave = `${p.desde.getTime()}-${p.hasta.getTime()}`;
    if (vistos.has(clave)) continue;
    vistos.add(clave);
    extra.push(p);
  }
  return [reciente, ...extra];
}

export async function sedesOperables(
  prisma: PrismaClient,
  args: {
    userId: string;
    tiendaId: string | null;
    /** Periodos extra que mirar además del reciente (la semana del arqueo). */
    periodos?: RangoDias[];
  },
): Promise<string[]> {
  const propias = await sedesDelUsuario(prisma, args);

  const hoy = new Date(`${diaMadrid()}T00:00:00Z`);
  const ventanas = ventanasDeTrabajo(hoy, args.periodos ?? []);
  const porFecha = ventanas.map((v) => ({ fecha: { gte: v.desde, lte: v.hasta } }));
  // El fichaje lleva hora, así que el último día entra entero.
  const porTimestamp = ventanas.map((v) => ({
    timestamp: { gte: v.desde, lt: new Date(v.hasta.getTime() + DIA_MS) },
  }));
  const activa = { tienda: { activa: true } };

  const [cierres, turnos, fichajes] = await Promise.all([
    prisma.cierreTurno.findMany({
      where: { userId: args.userId, ...activa, OR: porFecha },
      select: { tiendaId: true, fecha: true },
    }),
    prisma.turno.findMany({
      // Solo el cuadrante publicado: un borrador todavía no dice dónde trabaja
      // nadie. Y un turno confirmado como no realizado tampoco.
      where: {
        userId: args.userId,
        estado: "PUBLICADO",
        noRealizado: false,
        ...activa,
        OR: porFecha,
      },
      select: { tiendaId: true, fecha: true },
    }),
    prisma.fichaje.findMany({
      where: { userId: args.userId, ...activa, OR: porTimestamp },
      select: { tiendaId: true, timestamp: true },
    }),
  ]);

  // Lo más cercano a hoy primero: el orden importa porque quien no tiene sede en
  // su ficha declara por defecto en la primera de la lista, y esa tiene que ser
  // donde está trabajando ahora —el cierre que confirmó hoy—, no un turno que
  // cubrió hace tres semanas ni el del viernes que viene.
  const trabajo = [
    ...cierres.map((c) => ({ tiendaId: c.tiendaId, cuando: c.fecha })),
    ...turnos.map((t) => ({ tiendaId: t.tiendaId, cuando: t.fecha })),
    ...fichajes.map((f) => ({ tiendaId: f.tiendaId, cuando: f.timestamp })),
  ].sort((a, b) => distanciaAHoy(a.cuando, hoy) - distanciaAHoy(b.cuando, hoy));

  // Las propias antes que nada: quien tiene sede en su ficha sigue teniéndola
  // como principal, que es de la que se declara el arqueo si no se dice otra.
  const ids = [...propias, ...trabajo.map((t) => t.tiendaId)];
  return [...new Set(ids.filter((id): id is string => Boolean(id)))];
}

function distanciaAHoy(cuando: Date, hoy: Date): number {
  return Math.abs(cuando.getTime() - hoy.getTime());
}
