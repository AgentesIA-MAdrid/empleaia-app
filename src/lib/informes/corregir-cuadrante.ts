/**
 * Qué significa "corregir el cuadrante" en cada discrepancia (ticket c1e94a7b).
 *
 * Lo decide una función pura para poder probarlo sin BD, porque cada tipo hace
 * algo distinto y ninguno es evidente:
 *
 *  - `sede_distinta` — el cuadrante decía una tienda y se fichó en otra: al
 *    turno se le cambia la sede. Lo que había queda escrito en el turno y en el
 *    historial, y el turno se marca corregido (amarillo en el cuadrante).
 *  - `sin_turno` — fichó un día sin turno: se CREA el turno, con las horas de
 *    sus fichajes de ese día (de su entrada a su salida). Si aún no ha fichado
 *    la salida, se deja abierto con el horario de la sede y se puede reajustar.
 *  - `turno_sin_fichaje` — tenía turno y no fichó: el turno NO se borra (decisión
 *    del cliente), se marca como no realizado. Sigue en el cuadrante en amarillo
 *    para no perder de vista lo que estaba previsto, pero sus horas dejan de
 *    contar en el informe de horas y pasan a la hoja de incidencias.
 *
 * En los tres casos se guarda el antes y el después EN TEXTO: el turno se puede
 * volver a tocar o la sede desaparecer, y el historial tiene que seguir contando
 * lo que pasó.
 */

export type TipoDiscrepancia = "sede_distinta" | "sin_turno" | "turno_sin_fichaje";

/** Lo que hay que escribir en la BD para aplicar una corrección. */
export type PlanCorreccion =
  | {
      accion: "cambiar_sede";
      turnoId: string;
      tiendaId: string;
      antes: string;
      despues: string;
    }
  | {
      accion: "crear_turno";
      tiendaId: string;
      horaInicio: string;
      horaFin: string;
      antes: string;
      despues: string;
    }
  | {
      accion: "marcar_no_realizado";
      turnoId: string;
      antes: string;
      despues: string;
    };

export interface DatosCorreccion {
  tipo: TipoDiscrepancia;
  /** Turno afectado. Falta en `sin_turno`, que es el caso en que no hay. */
  turno: { id: string; horaInicio: string; horaFin: string; sedeNombre: string | null } | null;
  /** Sede con la que quedó registrado el fichaje (a la que hay que cuadrar). */
  fichaje: { tiendaId: string | null; sedeNombre: string | null } | null;
  /** Horas fichadas ese día, si las hay: "HH:MM". */
  horasFichadas?: { entrada: string | null; salida: string | null };
  /** Horario de la sede, para el turno que se crea sin salida fichada. */
  horarioSede?: { apertura: string; cierre: string } | null;
}

/** Cómo se cuenta un turno en el historial. */
function describeTurno(t: { horaInicio: string; horaFin: string; sedeNombre: string | null }): string {
  return `${t.sedeNombre ?? "sin sede"} ${t.horaInicio}-${t.horaFin}`;
}

export type ResultadoPlan =
  | { ok: true; plan: PlanCorreccion }
  | { ok: false; error: string };

export function planificarCorreccion(d: DatosCorreccion): ResultadoPlan {
  if (d.tipo === "sede_distinta") {
    if (!d.turno) return { ok: false, error: "No se encuentra el turno que había que corregir." };
    if (!d.fichaje?.tiendaId) {
      return { ok: false, error: "El fichaje no tiene sede con la que cuadrar el turno." };
    }
    return {
      ok: true,
      plan: {
        accion: "cambiar_sede",
        turnoId: d.turno.id,
        tiendaId: d.fichaje.tiendaId,
        antes: describeTurno(d.turno),
        despues: `${d.fichaje.sedeNombre ?? "sede del fichaje"} ${d.turno.horaInicio}-${d.turno.horaFin}`,
      },
    };
  }

  if (d.tipo === "sin_turno") {
    if (!d.fichaje?.tiendaId) {
      return { ok: false, error: "El fichaje no tiene sede: no hay dónde crear el turno." };
    }
    const entrada = d.horasFichadas?.entrada;
    if (!entrada) return { ok: false, error: "No hay entrada fichada con la que crear el turno." };
    // Sin salida fichada todavía, el cierre de la sede es la mejor estimación:
    // el turno se crea abierto y se puede reajustar en el cuadrante.
    const salida = d.horasFichadas?.salida ?? d.horarioSede?.cierre ?? null;
    if (!salida) {
      return {
        ok: false,
        error: "Aún no ha fichado la salida y su sede no tiene horario: pon las horas a mano.",
      };
    }
    return {
      ok: true,
      plan: {
        accion: "crear_turno",
        tiendaId: d.fichaje.tiendaId,
        horaInicio: entrada,
        horaFin: salida,
        antes: "sin turno en el cuadrante",
        despues: `${d.fichaje.sedeNombre ?? "sede del fichaje"} ${entrada}-${salida}`,
      },
    };
  }

  // turno_sin_fichaje
  if (!d.turno) return { ok: false, error: "No se encuentra el turno que había que corregir." };
  return {
    ok: true,
    plan: {
      accion: "marcar_no_realizado",
      turnoId: d.turno.id,
      antes: describeTurno(d.turno),
      despues: "no realizado (sus horas no cuentan en el informe de horas)",
    },
  };
}
