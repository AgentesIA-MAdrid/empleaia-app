/**
 * Relleno automático de turnos de "oficina por defecto".
 *
 * Regla de negocio (ticket /admin/turnos): para los empleados marcados con
 * `User.turnoOficinaPorDefecto`, los días de la semana visible en que NO
 * tengan ningún turno en una tienda (ni una ausencia aprobada) se asignan
 * solos a un turno de 09:00–17:00 en la sede marcada como oficina
 * (`Tienda.esOficina`). En cuanto el día se cubre en una tienda —o el
 * empleado pasa a estar ausente— ese turno automático se retira.
 *
 * Lógica de dominio pura: recibe el cliente Prisma del tenant como
 * dependencia (mismo patrón que `src/lib/informes/queries.ts`) y no hace
 * red ni resuelve tenant por su cuenta. El caller (route handler) ya está
 * dentro de `withTenant`/`runWithTenant`.
 *
 * Idempotente: aplicar la reconciliación dos veces sobre las mismas fechas
 * no crea duplicados ni borra de más.
 */

import type { PrismaClient } from "@/generated/prisma-tenant/client";
import { EstadoTurno, EstadoAusencia } from "@/generated/prisma-tenant/client";

export const HORA_INICIO_OFICINA = "09:00";
export const HORA_FIN_OFICINA = "17:00";

export interface ReconcileResult {
  creados: number;
  eliminados: number;
}

/** yyyy-MM-dd del `Date` en UTC (los turnos se guardan a medianoche UTC). */
function claveDia(fecha: Date): string {
  return fecha.toISOString().slice(0, 10);
}

/**
 * Reconcilia los turnos de oficina por defecto para el conjunto de días
 * `fechas` (cada una en formato "yyyy-MM-dd", tal cual las envía el
 * cuadrante). Devuelve cuántos turnos automáticos se crearon y se
 * eliminaron.
 */
export async function reconciliarTurnosOficina(
  prisma: PrismaClient,
  fechas: string[],
): Promise<ReconcileResult> {
  const diasValidos = [...new Set(fechas)]
    .filter((f) => /^\d{4}-\d{2}-\d{2}$/.test(f))
    .sort();
  if (diasValidos.length === 0) return { creados: 0, eliminados: 0 };

  // La sede oficina debe existir y estar activa; si no, no hay a dónde
  // asignar y no se toca nada.
  const oficina = await prisma.tienda.findFirst({
    where: { esOficina: true, activa: true },
    select: { id: true },
  });
  if (!oficina) return { creados: 0, eliminados: 0 };

  const empleados = await prisma.user.findMany({
    where: { turnoOficinaPorDefecto: true, activo: true, anonimizadoAt: null },
    select: { id: true },
  });
  if (empleados.length === 0) return { creados: 0, eliminados: 0 };
  const empleadoIds = empleados.map((e) => e.id);

  // Rango [primer día 00:00 UTC, último día 23:59:59.999 UTC] que cubre
  // todas las fechas pedidas, para una sola consulta de turnos/ausencias.
  const rangoInicio = new Date(`${diasValidos[0]}T00:00:00.000Z`);
  const rangoFin = new Date(`${diasValidos[diasValidos.length - 1]}T23:59:59.999Z`);

  const turnos = await prisma.turno.findMany({
    where: {
      userId: { in: empleadoIds },
      fecha: { gte: rangoInicio, lte: rangoFin },
    },
    select: { id: true, userId: true, fecha: true, generadoAuto: true },
  });

  const ausencias = await prisma.ausencia.findMany({
    where: {
      userId: { in: empleadoIds },
      estado: EstadoAusencia.APROBADA,
      fechaInicio: { lte: rangoFin },
      fechaFin: { gte: rangoInicio },
    },
    select: { userId: true, fechaInicio: true, fechaFin: true },
  });

  const idsAEliminar: string[] = [];
  const aCrear: { userId: string; fecha: Date }[] = [];

  for (const userId of empleadoIds) {
    for (const dia of diasValidos) {
      const inicioDia = new Date(`${dia}T00:00:00.000Z`);
      const finDia = new Date(`${dia}T23:59:59.999Z`);

      const turnosDia = turnos.filter(
        (t) => t.userId === userId && claveDia(t.fecha) === dia,
      );
      const tieneTurnoReal = turnosDia.some((t) => !t.generadoAuto);
      const autos = turnosDia.filter((t) => t.generadoAuto);

      const ausente = ausencias.some(
        (a) =>
          a.userId === userId &&
          a.fechaInicio <= finDia &&
          a.fechaFin >= inicioDia,
      );

      if (tieneTurnoReal || ausente) {
        // El día ya está cubierto (tienda) o la persona está ausente: el
        // turno automático sobra. Se retira siempre (lo creó el sistema).
        idsAEliminar.push(...autos.map((t) => t.id));
      } else if (autos.length === 0) {
        // Día libre de tienda y sin ausencia: falta el turno de oficina.
        aCrear.push({ userId, fecha: inicioDia });
      } else if (autos.length > 1) {
        // Deduplica: conserva uno y limpia los sobrantes.
        idsAEliminar.push(...autos.slice(1).map((t) => t.id));
      }
    }
  }

  if (idsAEliminar.length > 0) {
    await prisma.turno.deleteMany({ where: { id: { in: idsAEliminar } } });
  }
  if (aCrear.length > 0) {
    await prisma.turno.createMany({
      data: aCrear.map(({ userId, fecha }) => ({
        userId,
        tiendaId: oficina.id,
        tipoTurnoId: null,
        fecha,
        horaInicio: HORA_INICIO_OFICINA,
        horaFin: HORA_FIN_OFICINA,
        estado: EstadoTurno.BORRADOR,
        generadoAuto: true,
      })),
    });
  }

  return { creados: aCrear.length, eliminados: idsAEliminar.length };
}
