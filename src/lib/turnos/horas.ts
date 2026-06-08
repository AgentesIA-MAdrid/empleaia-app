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
