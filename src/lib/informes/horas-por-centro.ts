/**
 * Horas por empleado y centro (sede) en un periodo, con dos orígenes:
 *
 *  - `fichajes` (horas reales): empareja cada ENTRADA/VUELTA_PAUSA con la
 *    siguiente PAUSA/SALIDA del mismo empleado y atribuye los minutos a la
 *    sede donde fichó la entrada.
 *  - `cuadrante` (horas planificadas): suma las horas de cada turno del
 *    cuadrante y las atribuye a la sede del turno. Cuenta igual que la
 *    pantalla de Turnos y su export a Excel porque comparte `horasDeTurno`
 *    y la misma regla de ausencias.
 *
 * Funciones puras (reciben el cliente Prisma) → testeables sin red ni BD real.
 */

import type { PrismaClient } from "@/generated/prisma-tenant/client";
import { EstadoAusencia } from "@/generated/prisma-tenant/client";
import {
  horasDeTurno,
  indexarAusencias,
  diaConAusencia,
  type TurnoLite,
  type AusenciaLite,
} from "@/lib/turnos/horas";

/** De dónde salen las horas del informe. */
export type OrigenHorasCentro = "fichajes" | "cuadrante";

export const ORIGENES_HORAS_CENTRO: readonly OrigenHorasCentro[] = [
  "fichajes",
  "cuadrante",
];

export interface FilaHorasCentro {
  userId: string;
  empleado: string;
  tiendaId: string | null;
  centro: string;
  minutos: number;
  horas: number;
}

interface FichajeMin {
  userId: string;
  tiendaId: string | null;
  tipo: string;
  timestamp: Date;
  user: { nombre: string; apellidos: string };
  tienda: { nombre: string } | null;
}

/** Calcula los minutos trabajados por (empleado, centro) a partir de fichajes ya ordenables. */
export function agregarHorasPorCentro(fichajes: FichajeMin[]): FilaHorasCentro[] {
  // Ordena por empleado y luego por hora.
  const orden = [...fichajes].sort((a, b) =>
    a.userId === b.userId
      ? a.timestamp.getTime() - b.timestamp.getTime()
      : a.userId.localeCompare(b.userId),
  );

  // acc[userId|tiendaId] -> { minutos, empleado, centro, tiendaId, userId }
  const acc = new Map<string, FilaHorasCentro>();
  const meta = new Map<string, { empleado: string; centroPorTienda: Map<string, string> }>();

  let abierto: { userId: string; time: number; tiendaId: string | null } | null = null;

  for (const f of orden) {
    // Registra metadatos del empleado/centro para las etiquetas.
    if (!meta.has(f.userId)) {
      meta.set(f.userId, {
        empleado: `${f.user.nombre} ${f.user.apellidos}`.trim(),
        centroPorTienda: new Map(),
      });
    }
    if (f.tiendaId && f.tienda) {
      meta.get(f.userId)!.centroPorTienda.set(f.tiendaId, f.tienda.nombre);
    }

    const esApertura = f.tipo === "ENTRADA" || f.tipo === "VUELTA_PAUSA";
    const esCierre = f.tipo === "PAUSA" || f.tipo === "SALIDA";

    if (esApertura) {
      abierto = { userId: f.userId, time: f.timestamp.getTime(), tiendaId: f.tiendaId };
    } else if (esCierre && abierto && abierto.userId === f.userId) {
      const min = Math.max(0, Math.round((f.timestamp.getTime() - abierto.time) / 60000));
      const tiendaId = abierto.tiendaId;
      const key = `${f.userId}::${tiendaId ?? "sin"}`;
      const empleado = meta.get(f.userId)!.empleado;
      const centro =
        tiendaId ? (meta.get(f.userId)!.centroPorTienda.get(tiendaId) ?? "—") : "Sin sede";
      const fila = acc.get(key);
      if (fila) fila.minutos += min;
      else acc.set(key, { userId: f.userId, empleado, tiendaId, centro, minutos: min, horas: 0 });
      abierto = null;
    }
  }

  return [...acc.values()]
    .map((f) => ({ ...f, horas: Math.round((f.minutos / 60) * 100) / 100 }))
    .sort((a, b) => a.empleado.localeCompare(b.empleado, "es") || a.centro.localeCompare(b.centro, "es"));
}

/** Carga los fichajes del periodo (con scope) y devuelve la agregación. */
export async function calcularHorasPorCentro(opts: {
  prisma: PrismaClient;
  fechaInicio: Date;
  fechaFin: Date;
  /** Si se pasa, limita a una sede (para MANAGER). */
  tiendaId?: string | null;
}): Promise<FilaHorasCentro[]> {
  const { prisma, fechaInicio, fechaFin, tiendaId } = opts;
  const fichajes = await prisma.fichaje.findMany({
    where: {
      timestamp: { gte: fechaInicio, lte: fechaFin },
      ...(tiendaId ? { tiendaId } : {}),
    },
    select: {
      userId: true,
      tiendaId: true,
      tipo: true,
      timestamp: true,
      user: { select: { nombre: true, apellidos: true } },
      tienda: { select: { nombre: true } },
    },
    orderBy: { timestamp: "asc" },
  });
  return agregarHorasPorCentro(fichajes as FichajeMin[]);
}

/** Turno del cuadrante con lo mínimo para agregar horas y etiquetar la fila. */
export interface TurnoMin extends TurnoLite {
  userId: string;
  tiendaId: string | null;
  /** Día del turno (medianoche UTC). Necesario para cruzarlo con ausencias. */
  fecha: Date | string;
  user: { nombre: string; apellidos: string };
  tienda: { nombre: string } | null;
}

/**
 * Agrega las horas PLANIFICADAS del cuadrante por (empleado, centro).
 *
 * Las horas de cada turno salen de `horasDeTurno` (tipo de turno > rango
 * horario, LIBRE = 0), la misma función que usan la pantalla de Turnos y el
 * export del cuadrante: así el informe cuadra con lo que el cliente ve ahí.
 * Se acumula en minutos enteros para no arrastrar error de coma flotante.
 *
 * Los turnos que caen en un día con ausencia APROBADA se descartan: la
 * persona no trabaja ese día, así que sus horas no son horas planificadas
 * (el turno viejo que quedó bajo unas vacaciones/baja aprobadas después
 * inflaba el informe). Si tras el descarte alguien se queda sin turnos, no
 * aparece en el informe.
 */
export function agregarHorasCuadrantePorCentro(
  turnos: TurnoMin[],
  ausencias: AusenciaLite[] = [],
): FilaHorasCentro[] {
  const indiceAusencias = indexarAusencias(ausencias);
  const acc = new Map<string, FilaHorasCentro>();
  for (const t of turnos) {
    if (diaConAusencia(t.userId, t.fecha, indiceAusencias)) continue;
    const key = `${t.userId}::${t.tiendaId ?? "sin"}`;
    const minutos = Math.max(0, Math.round(horasDeTurno(t) * 60));
    const fila = acc.get(key);
    if (fila) {
      fila.minutos += minutos;
      continue;
    }
    acc.set(key, {
      userId: t.userId,
      empleado: `${t.user.nombre} ${t.user.apellidos}`.trim(),
      tiendaId: t.tiendaId,
      centro: t.tienda?.nombre ?? (t.tiendaId ? "—" : "Sin sede"),
      minutos,
      horas: 0,
    });
  }
  return [...acc.values()]
    .map((f) => ({ ...f, horas: Math.round((f.minutos / 60) * 100) / 100 }))
    .sort(
      (a, b) =>
        a.empleado.localeCompare(b.empleado, "es") ||
        a.centro.localeCompare(b.centro, "es"),
    );
}

/** Carga los turnos del periodo (con scope) y devuelve la agregación. */
export async function calcularHorasPorCentroCuadrante(opts: {
  prisma: PrismaClient;
  fechaInicio: Date;
  fechaFin: Date;
  /** Si se pasa, limita a una sede (para MANAGER o filtro del OWNER). */
  tiendaId?: string | null;
}): Promise<FilaHorasCentro[]> {
  const { prisma, fechaInicio, fechaFin, tiendaId } = opts;
  const turnos = await prisma.turno.findMany({
    where: {
      fecha: { gte: fechaInicio, lte: fechaFin },
      ...(tiendaId ? { tiendaId } : {}),
      // Solo personas de alta: el cuadrante (`/api/empleados?activo=true`) y su
      // export a Excel ya filtran así, y sin esto el informe facturaba turnos
      // de gente dada de baja o eliminada que no sale por ningún otro sitio.
      user: { activo: true, anonimizadoAt: null },
    },
    select: {
      userId: true,
      tiendaId: true,
      fecha: true,
      horaInicio: true,
      horaFin: true,
      // `horas` llega como Decimal; `horasDeTurno` ya acepta Decimal/string.
      tipoTurno: {
        select: { abreviatura: true, nombre: true, horas: true, esLibre: true },
      },
      user: { select: { nombre: true, apellidos: true } },
      tienda: { select: { nombre: true } },
    },
    orderBy: { fecha: "asc" },
  });
  if (turnos.length === 0) return [];

  // Ausencias APROBADAS que solapan el periodo: sus días no computan horas
  // planificadas aunque haya quedado un turno viejo debajo.
  const ausencias = await prisma.ausencia.findMany({
    where: {
      userId: { in: [...new Set(turnos.map((t) => t.userId))] },
      estado: EstadoAusencia.APROBADA,
      fechaInicio: { lte: fechaFin },
      fechaFin: { gte: fechaInicio },
    },
    select: { userId: true, fechaInicio: true, fechaFin: true },
  });

  return agregarHorasCuadrantePorCentro(turnos as TurnoMin[], ausencias);
}
