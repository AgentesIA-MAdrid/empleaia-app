/**
 * Discrepancias entre el cuadrante y lo que se fichó (ticket 5f83b0c7).
 *
 * Tres cosas que no cuadran y que hoy no salían en ninguna pantalla:
 *
 *  1. `sede_distinta` — el cuadrante le puso en una tienda y su fichaje quedó
 *     registrado en otra.
 *  2. `sin_turno` — fichó un día en el que no tenía turno publicado.
 *  3. `turno_sin_fichaje` — tenía turno y no fichó nada.
 *
 * Sobre el caso de la sede, conviene saber qué se está comparando: el fichaje
 * guarda la sede **asignada** al empleado (`User.tiendaId` en el momento de
 * fichar), no dónde estaba físicamente. Así que esto detecta que el cuadrante y
 * la ficha no coinciden —lo típico cuando alguien cubre en otra tienda—, y la
 * ubicación real, cuando el móvil la dio, entra como dato de apoyo: los metros a
 * los que fichó de su sede asignada.
 *
 * Ese apoyo se marca con una tolerancia de 2 km (decisión del cliente): por
 * debajo se da por hecho que estaba en su sede —el GPS urbano se desvía y no
 * queremos ruido—, y por encima se señala, que es la señal de que de verdad
 * estaba en otro sitio.
 *
 * El tercer caso no cuenta si ese día tenía una **ausencia aprobada**: unas
 * vacaciones o una baja explican perfectamente que no haya fichaje, y sacarlas
 * como incidencia haría que el cuadro se ignorara.
 *
 * Función pura: recibe los datos ya leídos, así que se prueba sin BD (misma
 * pauta que `retrasos.ts`).
 */

import { hhmmToMin, partesEnZona } from "@/lib/fichajes/horario-turno";

/** Metros a los que se deja de dar por buena la ubicación (decisión del cliente). */
export const TOLERANCIA_UBICACION_M = 2000;

export type TipoDiscrepancia = "sede_distinta" | "sin_turno" | "turno_sin_fichaje";

export interface EntradaConSede {
  userId: string;
  timestamp: Date;
  /** Sede con la que quedó registrado el fichaje. */
  tiendaId: string | null;
  /** Metros a su sede asignada, si el móvil dio ubicación. */
  distancia: number | null;
}

export interface TurnoConSede {
  userId: string;
  fecha: Date;
  tiendaId: string | null;
  /** "HH:MM" — para emparejar la entrada con su turno en jornada partida. */
  horaInicio: string;
}

/** Ausencia aprobada: explica un turno sin fichaje. */
export interface AusenciaAprobada {
  userId: string;
  fechaInicio: Date;
  fechaFin: Date;
}

export interface Discrepancia {
  userId: string;
  /** "YYYY-MM-DD" en la zona del cliente. */
  dia: string;
  tipo: TipoDiscrepancia;
  /** Sede que decía el cuadrante. null en `sin_turno`. */
  sedeTurnoId: string | null;
  /** Sede con la que se registró el fichaje. null en `turno_sin_fichaje`. */
  sedeFichajeId: string | null;
  /** Hora del fichaje ("HH:MM") o del inicio del turno que no se fichó. */
  hora: string;
  /** Metros a su sede asignada, si los hubo. */
  distancia: number | null;
  /** true = fichó a más de la tolerancia de su sede: estaba en otro sitio. */
  lejos: boolean;
}

/** "HH:MM" a partir de los minutos del día. */
function hhmm(min: number): string {
  const h = Math.floor(((min % 1440) + 1440) % 1440 / 60);
  const m = (((min % 1440) + 1440) % 1440) % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** ¿Ese día cae dentro de una ausencia aprobada? */
function cubiertoPorAusencia(
  ausencias: AusenciaAprobada[],
  userId: string,
  dia: string,
  zona: string,
): boolean {
  return ausencias.some((a) => {
    if (a.userId !== userId) return false;
    const ini = partesEnZona(a.fechaInicio, zona).fecha;
    const fin = partesEnZona(a.fechaFin, zona).fecha;
    return dia >= ini && dia <= fin;
  });
}

/**
 * Cruza fichajes, cuadrante y ausencias y devuelve una incidencia por cada cosa
 * que no cuadra, de la más reciente a la más antigua.
 */
export function detectarDiscrepancias(args: {
  entradas: EntradaConSede[];
  turnos: TurnoConSede[];
  ausencias?: AusenciaAprobada[];
  zona: string;
  /** Metros a partir de los cuales se señala la ubicación. */
  toleranciaM?: number;
}): Discrepancia[] {
  const { entradas, turnos, zona } = args;
  const ausencias = args.ausencias ?? [];
  const tolerancia = args.toleranciaM ?? TOLERANCIA_UBICACION_M;

  // Turnos por persona y día.
  const turnosPorDia = new Map<string, TurnoConSede[]>();
  for (const t of turnos) {
    const clave = `${t.userId}|${partesEnZona(t.fecha, zona).fecha}`;
    const previo = turnosPorDia.get(clave);
    if (previo) previo.push(t);
    else turnosPorDia.set(clave, [t]);
  }

  const fuera: Discrepancia[] = [];
  /** Días-persona con al menos una entrada, para el caso 3. */
  const conEntrada = new Set<string>();

  for (const e of entradas) {
    const { fecha: dia, minutos } = partesEnZona(e.timestamp, zona);
    const clave = `${e.userId}|${dia}`;
    conEntrada.add(clave);
    const delDia = turnosPorDia.get(clave) ?? [];
    const lejos = e.distancia !== null && e.distancia > tolerancia;

    if (delDia.length === 0) {
      fuera.push({
        userId: e.userId,
        dia,
        tipo: "sin_turno",
        sedeTurnoId: null,
        sedeFichajeId: e.tiendaId,
        hora: hhmm(minutos),
        distancia: e.distancia,
        lejos,
      });
      continue;
    }

    // Si alguno de sus turnos de ese día es de la misma sede, cuadra: quien
    // tiene jornada partida en dos tiendas no debe salir por la que no toca.
    if (delDia.some((t) => t.tiendaId === e.tiendaId)) continue;

    // El turno al que corresponde la entrada: el de inicio más cercano.
    let turno = delDia[0]!;
    for (const cand of delDia) {
      const d = Math.abs(minutos - hhmmToMin(cand.horaInicio));
      if (d < Math.abs(minutos - hhmmToMin(turno.horaInicio))) turno = cand;
    }
    fuera.push({
      userId: e.userId,
      dia,
      tipo: "sede_distinta",
      sedeTurnoId: turno.tiendaId,
      sedeFichajeId: e.tiendaId,
      hora: hhmm(minutos),
      distancia: e.distancia,
      lejos,
    });
  }

  // Caso 3: turnos publicados sin ninguna entrada ese día. Uno por día y
  // persona, aunque tenga dos turnos: la incidencia es "no vino", no "le faltan
  // dos fichajes".
  const yaVisto = new Set<string>();
  for (const t of turnos) {
    const dia = partesEnZona(t.fecha, zona).fecha;
    const clave = `${t.userId}|${dia}`;
    if (conEntrada.has(clave) || yaVisto.has(clave)) continue;
    if (cubiertoPorAusencia(ausencias, t.userId, dia, zona)) continue;
    yaVisto.add(clave);
    fuera.push({
      userId: t.userId,
      dia,
      tipo: "turno_sin_fichaje",
      sedeTurnoId: t.tiendaId,
      sedeFichajeId: null,
      hora: t.horaInicio,
      distancia: null,
      lejos: false,
    });
  }

  return fuera.sort((a, b) => b.dia.localeCompare(a.dia) || a.hora.localeCompare(b.hora));
}

/** Cuántas incidencias de cada tipo, para el resumen de arriba del cuadro. */
export function resumirDiscrepancias(ds: Discrepancia[]): Record<TipoDiscrepancia, number> {
  return {
    sede_distinta: ds.filter((d) => d.tipo === "sede_distinta").length,
    sin_turno: ds.filter((d) => d.tipo === "sin_turno").length,
    turno_sin_fichaje: ds.filter((d) => d.tipo === "turno_sin_fichaje").length,
  };
}
