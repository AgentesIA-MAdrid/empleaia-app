/**
 * Horario de oficina automático.
 *
 * Para los empleados marcados con `autoTurnoOficina`, rellena los días
 * laborables (L-V) de la semana que queden SIN ningún turno en ninguna sede
 * con un turno de 09:00–17:00 en la sede "Oficina". Los días con una ausencia
 * aprobada (baja/vacaciones) no se rellenan.
 *
 * La sede oficina se reconoce por su nombre ("Oficina", sin distinguir
 * mayúsculas/acentos de caja) tal y como el cliente la nombró: es una
 * `Tienda` normal, no hay un tipo de sede especial en el modelo.
 *
 * Disparo: la página del cuadrante llama al endpoint
 * `POST /api/turnos/cuadrante/rellenar-oficina` al pulsar "Publicar todos",
 * antes de publicar los borradores. Los turnos se crean como BORRADOR y la
 * propia publicación los pasa a PUBLICADO.
 *
 * La decisión de qué días son laborables (`diasLaborables`) es pura y
 * testeable; el resto recibe `prismaApp` del tenant activo.
 */

import type { PrismaClient } from "@/generated/prisma-tenant/client";
import { EstadoTurno, EstadoAusencia } from "@/generated/prisma-tenant/client";

export const OFICINA_HORA_INICIO = "09:00";
export const OFICINA_HORA_FIN = "17:00";

/** Los turnos del cuadrante se guardan como fecha-solo (medianoche UTC del
 *  día natural). Su clave de día es, por tanto, los 10 primeros caracteres
 *  del ISO. Mismo criterio para los días pedidos ("YYYY-MM-DD"). */
function claveDia(fecha: Date): string {
  return fecha.toISOString().slice(0, 10);
}

/**
 * De una lista de días ("YYYY-MM-DD") devuelve solo los laborables (L-V).
 * Se construye la fecha a medianoche UTC (los días del cuadrante son
 * fecha-solo) y se descartan sábado (6) y domingo (0).
 */
export function diasLaborables(dias: string[]): string[] {
  return dias.filter((d) => {
    const dow = new Date(`${d}T00:00:00.000Z`).getUTCDay();
    return dow !== 0 && dow !== 6;
  });
}

export interface RellenoOficinaResultado {
  /** Turnos de oficina creados. */
  creados: number;
  /** true si hay empleados marcados pero no existe ninguna sede "Oficina". */
  sinOficina: boolean;
  /** Nº de empleados marcados con `autoTurnoOficina` (activos). */
  empleados: number;
}

/**
 * Crea los turnos de oficina que falten para la semana indicada.
 *
 * @param prisma cliente del tenant activo (prismaApp).
 * @param dias   días de la semana visible en formato "YYYY-MM-DD".
 */
export async function rellenarOficina(
  prisma: PrismaClient,
  dias: string[],
): Promise<RellenoOficinaResultado> {
  const laborables = diasLaborables(dias);
  if (laborables.length === 0) {
    return { creados: 0, sinOficina: false, empleados: 0 };
  }

  // Empleados marcados para el relleno automático (activos, no anonimizados).
  const empleados = await prisma.user.findMany({
    where: { autoTurnoOficina: true, activo: true, anonimizadoAt: null },
    select: { id: true },
  });
  if (empleados.length === 0) {
    return { creados: 0, sinOficina: false, empleados: 0 };
  }

  // Sede "Oficina" (por nombre, sin distinguir mayúsculas), activa.
  const oficina = await prisma.tienda.findFirst({
    where: { activa: true, nombre: { equals: "oficina", mode: "insensitive" } },
    select: { id: true },
    orderBy: { createdAt: "asc" },
  });
  if (!oficina) {
    return { creados: 0, sinOficina: true, empleados: empleados.length };
  }

  const userIds = empleados.map((e) => e.id);
  const orden = [...laborables].sort();
  const desde = new Date(`${orden[0]}T00:00:00.000Z`);
  const hasta = new Date(`${orden[orden.length - 1]}T23:59:59.999Z`);

  // Turnos ya existentes de estos empleados en la ventana, en CUALQUIER sede.
  const existentes = await prisma.turno.findMany({
    where: { userId: { in: userIds }, fecha: { gte: desde, lte: hasta } },
    select: { userId: true, fecha: true },
  });
  const cubiertos = new Set(
    existentes.map((t) => `${t.userId}|${claveDia(t.fecha)}`),
  );

  // Días con ausencia APROBADA que solapan la ventana: no se rellenan (la
  // persona está de baja/vacaciones), igual que el cuadrante oculta el "+".
  const ausencias = await prisma.ausencia.findMany({
    where: {
      userId: { in: userIds },
      estado: EstadoAusencia.APROBADA,
      fechaInicio: { lte: hasta },
      fechaFin: { gte: desde },
    },
    select: { userId: true, fechaInicio: true, fechaFin: true },
  });
  for (const a of ausencias) {
    const ini = claveDia(a.fechaInicio);
    const fin = claveDia(a.fechaFin);
    for (const dia of laborables) {
      if (dia >= ini && dia <= fin) cubiertos.add(`${a.userId}|${dia}`);
    }
  }

  const aCrear: { userId: string; fecha: Date }[] = [];
  for (const userId of userIds) {
    for (const dia of laborables) {
      if (!cubiertos.has(`${userId}|${dia}`)) {
        aCrear.push({ userId, fecha: new Date(`${dia}T00:00:00.000Z`) });
      }
    }
  }
  if (aCrear.length === 0) {
    return { creados: 0, sinOficina: false, empleados: empleados.length };
  }

  await prisma.turno.createMany({
    data: aCrear.map(({ userId, fecha }) => ({
      userId,
      tiendaId: oficina.id,
      tipoTurnoId: null,
      fecha,
      horaInicio: OFICINA_HORA_INICIO,
      horaFin: OFICINA_HORA_FIN,
      estado: EstadoTurno.BORRADOR,
    })),
  });

  return { creados: aCrear.length, sinOficina: false, empleados: empleados.length };
}
