/**
 * Vigilancia diaria de cierres incompletos (lógica pura).
 *
 * Al final del día, quien administra tiene que enterarse de quién no ha
 * cerrado. Dos reglas que evitan que el aviso se vuelva ruido y acabe
 * ignorado, que es la única forma de que un aviso deje de servir:
 *
 *  1. Solo se reclama a quien TENÍA TURNO ese día. Si no, cualquier día libre
 *     generaría una reclamación falsa.
 *  2. Un correo por sede con todos sus pendientes, no uno por persona. Con seis
 *     tiendas, un correo por comercial y día es una bandeja imposible.
 */

import type { PasoCierre } from "./core";
import { pasosPendientes } from "./core";

export interface TurnoDelDia {
  userId: string;
  nombre: string;
  tiendaId: string | null;
  tiendaNombre: string | null;
}

export interface CierreDelDia {
  userId: string;
  ventas: number;
  detalleJornada: string | null;
  cajaConfirmada: boolean;
  completadoEn: Date | null;
}

export interface PendienteSede {
  tiendaId: string | null;
  tiendaNombre: string;
  personas: { userId: string; nombre: string; pasos: PasoCierre[]; sinEmpezar: boolean }[];
}

/** Etiqueta legible de cada paso, para el correo. */
export const ETIQUETA_PASO: Record<PasoCierre, string> = {
  ventas: "ventas del día",
  resultados: "resultados",
  caja: "cierre de caja",
  arqueo: "arqueo semanal",
  incidencias: "cerrar el turno",
};

/**
 * Cruza los turnos del día con los cierres registrados y agrupa por sede lo
 * que falta. Devuelve solo las sedes con algo pendiente: una sede al día no
 * genera correo.
 */
export function agruparPendientesPorSede(
  turnos: TurnoDelDia[],
  cierres: CierreDelDia[],
): PendienteSede[] {
  const porUsuario = new Map(cierres.map((c) => [c.userId, c]));
  const sedes = new Map<string, PendienteSede>();

  for (const turno of turnos) {
    const cierre = porUsuario.get(turno.userId);

    // Cierre completo: nada que reclamar.
    if (cierre?.completadoEn) continue;

    const pasos = cierre
      ? pasosPendientes({
          ventas: cierre.ventas,
          detalleJornada: cierre.detalleJornada,
          cajaConfirmada: cierre.cajaConfirmada,
          completadoEn: cierre.completadoEn,
        })
      : (["ventas", "caja", "incidencias"] as PasoCierre[]);

    if (pasos.length === 0) continue;

    const clave = turno.tiendaId ?? "__sin_sede__";
    if (!sedes.has(clave)) {
      sedes.set(clave, {
        tiendaId: turno.tiendaId,
        tiendaNombre: turno.tiendaNombre ?? "Sin sede asignada",
        personas: [],
      });
    }
    sedes.get(clave)!.personas.push({
      userId: turno.userId,
      nombre: turno.nombre,
      pasos,
      sinEmpezar: !cierre,
    });
  }

  return [...sedes.values()]
    .filter((s) => s.personas.length > 0)
    .sort((a, b) => a.tiendaNombre.localeCompare(b.tiendaNombre, "es"));
}

/** Resumen de una persona para el correo: "Marta — no ha empezado". */
export function describirPendiente(p: PendienteSede["personas"][number]): string {
  if (p.sinEmpezar) return `${p.nombre} — no ha empezado el cierre`;
  return `${p.nombre} — le falta: ${p.pasos.map((x) => ETIQUETA_PASO[x]).join(", ")}`;
}

// ─── ¿A qué cliente le toca el aviso ahora? ───────────────────────────────────
//
// El cron corre cada hora para todo el SaaS y cada cliente elige su hora local.
// Sin esto, una hora fija global mandaría el aviso a media tarde a quien cierra
// a medianoche, o una hora antes de lo debido a un cliente en Canarias.

export interface AvisoConfig {
  activo: boolean;
  /** Hora local, 0-23. */
  hora: number;
  /** Zona IANA, p. ej. "Europe/Madrid" o "Atlantic/Canary". */
  zona: string;
  /** Último día ya avisado, "YYYY-MM-DD" en su zona. */
  ultimoDia: string | null;
}

export interface DecisionAviso {
  toca: boolean;
  /** Día local del cliente, para registrarlo tras avisar. */
  dia: string;
  motivo: "toca" | "desactivado" | "otra_hora" | "ya_avisado" | "zona_invalida";
}

/** Hora y día locales de un instante en una zona IANA. */
function localEn(zona: string, ahora: Date): { dia: string; hora: number } | null {
  try {
    const fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone: zona,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      hour12: false,
    });
    const p = Object.fromEntries(fmt.formatToParts(ahora).map((x) => [x.type, x.value]));
    // Con hour12:false, medianoche puede venir como "24" en algunos entornos.
    const hora = Number(p.hour) % 24;
    if (!p.year || Number.isNaN(hora)) return null;
    return { dia: `${p.year}-${p.month}-${p.day}`, hora };
  } catch {
    return null;
  }
}

/**
 * Decide si a este cliente le toca el aviso en esta ejecución del cron.
 *
 * Se compara solo la hora, no los minutos: el cron corre al principio de cada
 * hora y exigir el minuto exacto haría que un retraso de la cola se saltara el
 * aviso del día entero.
 */
export function decidirAviso(cfg: AvisoConfig, ahora: Date): DecisionAviso {
  const local = localEn(cfg.zona, ahora);
  if (!local) {
    // Zona mal escrita: se avisa en hora peninsular antes que no avisar.
    const fallback = localEn("Europe/Madrid", ahora);
    return {
      toca: false,
      dia: fallback?.dia ?? "",
      motivo: "zona_invalida",
    };
  }
  if (!cfg.activo) return { toca: false, dia: local.dia, motivo: "desactivado" };
  if (cfg.ultimoDia === local.dia) return { toca: false, dia: local.dia, motivo: "ya_avisado" };

  const horaObjetivo = Number.isInteger(cfg.hora) && cfg.hora >= 0 && cfg.hora <= 23 ? cfg.hora : 23;
  if (local.hora !== horaObjetivo) return { toca: false, dia: local.dia, motivo: "otra_hora" };

  return { toca: true, dia: local.dia, motivo: "toca" };
}

/**
 * Qué día hay que revisar cuando toca avisar.
 *
 * Normalmente el mismo día local. Pero un cliente que avisa de madrugada
 * —porque su tienda cierra a medianoche— tiene que recibir el resumen de la
 * jornada que acaba de terminar, no del día que empieza y en el que aún no ha
 * fichado nadie.
 */
export function diaARevisar(diaLocal: string, horaAviso: number): string {
  if (horaAviso >= 6) return diaLocal;
  const [y, m, d] = diaLocal.split("-").map(Number);
  const anterior = new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1));
  anterior.setUTCDate(anterior.getUTCDate() - 1);
  return anterior.toISOString().slice(0, 10);
}
