/**
 * Cálculo de horas de un turno y su etiqueta para el cuadrante.
 *
 * Lógica pura (sin Prisma ni red) → testeable. La usan tanto la UI del
 * cuadrante como el export a Excel para que ambos cuenten igual.
 *
 * Reglas:
 *  - Si el turno tiene `tipoTurno`: si es LIBRE computa 0; si el tipo
 *    define `horas` > 0 usa esas; si no, cae al rango horaInicio/horaFin.
 *  - Si no tiene tipo: deriva del rango. Si el rango cruza medianoche
 *    (fin < inicio) suma 24h.
 *  - Un turno que cae en un día con ausencia APROBADA no computa: ese día
 *    la persona no trabaja (`diaConAusencia`). Es la misma regla que ya
 *    aplica el cuadrante al crear turnos (celda bloqueada en ausencia) y el
 *    relleno de oficina por defecto (retira su turno si hay ausencia).
 */

export interface TipoTurnoLite {
  abreviatura?: string | null;
  nombre?: string | null;
  // number | string (Decimal serializado en JSON) | Prisma.Decimal (en
  // server, que implementa toString()).
  horas?: number | string | { toString(): string } | null;
  esLibre?: boolean | null;
}

export interface TurnoLite {
  horaInicio?: string | null;
  horaFin?: string | null;
  tipoTurno?: TipoTurnoLite | null;
}

/** Horas decimales entre dos "HH:MM". Cruce de medianoche => +24h. */
export function horasDeRango(
  horaInicio?: string | null,
  horaFin?: string | null,
): number {
  if (!horaInicio || !horaFin) return 0;
  const [h1, m1] = horaInicio.split(":").map(Number);
  const [h2, m2] = horaFin.split(":").map(Number);
  if ([h1, m1, h2, m2].some((n) => Number.isNaN(n))) return 0;
  let mins = h2 * 60 + m2 - (h1 * 60 + m1);
  if (mins < 0) mins += 24 * 60;
  return Math.round((mins / 60) * 100) / 100;
}

/** Horas que computa un turno (tipo o rango). */
export function horasDeTurno(t: TurnoLite): number {
  if (t.tipoTurno) {
    if (t.tipoTurno.esLibre) return 0;
    const h = Number(t.tipoTurno.horas);
    if (!Number.isNaN(h) && h > 0) return h;
  }
  return horasDeRango(t.horaInicio, t.horaFin);
}

/**
 * Ausencia aprobada, con lo mínimo para saber qué días NO se trabajan.
 * Las fechas pueden llegar como `Date` (servidor) o ISO string (JSON).
 */
export interface AusenciaLite {
  userId: string;
  fechaInicio: Date | string;
  fechaFin: Date | string;
}

/** Agrupa las ausencias por empleado para consultarlas turno a turno. */
export function indexarAusencias(
  ausencias: AusenciaLite[],
): Map<string, AusenciaLite[]> {
  const porUser = new Map<string, AusenciaLite[]>();
  for (const a of ausencias) {
    const lista = porUser.get(a.userId);
    if (lista) lista.push(a);
    else porUser.set(a.userId, [a]);
  }
  return porUser;
}

/**
 * ¿Ese día está cubierto por una ausencia aprobada de esa persona?
 *
 * Turnos y ausencias se guardan a medianoche UTC, así que el solape se mide
 * sobre el día UTC del turno (misma convención que
 * `src/lib/turnos/oficina-por-defecto.ts`).
 */
export function diaConAusencia(
  userId: string,
  fecha: Date | string,
  indice: Map<string, AusenciaLite[]>,
): boolean {
  const lista = indice.get(userId);
  if (!lista || lista.length === 0) return false;
  const dia = new Date(fecha);
  if (Number.isNaN(dia.getTime())) return false;
  const clave = dia.toISOString().slice(0, 10);
  const inicioDia = Date.parse(`${clave}T00:00:00.000Z`);
  const finDia = Date.parse(`${clave}T23:59:59.999Z`);
  return lista.some((a) => {
    const desde = new Date(a.fechaInicio).getTime();
    const hasta = new Date(a.fechaFin).getTime();
    if (Number.isNaN(desde) || Number.isNaN(hasta)) return false;
    return desde <= finDia && hasta >= inicioDia;
  });
}

/** Etiqueta corta para la celda: abreviatura > nombre > rango. */
export function etiquetaTurno(t: TurnoLite): string {
  if (t.tipoTurno) {
    const ab = (t.tipoTurno.abreviatura ?? "").trim();
    if (ab) return ab;
    const nom = (t.tipoTurno.nombre ?? "").trim();
    if (nom) return nom;
  }
  if (t.horaInicio && t.horaFin) return `${t.horaInicio}–${t.horaFin}`;
  return "—";
}
