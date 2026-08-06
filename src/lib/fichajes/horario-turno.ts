/**
 * Fichaje dentro del horario del cuadrante (ticket 25c81b6b).
 *
 * El cliente quiere que no se pueda fichar antes ni después del turno
 * publicado. Doctrina igual que el geofencing estricto del ticket #61: se
 * bloquea el camino fácil, NUNCA el registro de la jornada (RD 8/2019).
 *
 * Qué pasa con el intento rechazado (ticket c726acd0): nada, se rechaza con un
 * "Fuera de turno". El atajo de registrarlo ajustado al borde del turno con un
 * clic (ticket 9e4c2f10) lo ha retirado el cliente. Quien se olvida de fichar
 * lo pide desde Mis Fichajes y lo registra administración: esa es la única
 * puerta, y por eso el ajuste al borde del turno se sigue calculando aquí —lo
 * usa POST /api/solicitudes-fichaje para la clase "fuera_horario"—.
 *
 * Reglas:
 *  - Solo se comprueba si el tenant activó `exigirFichajeEnHorario`.
 *  - Solo se comprueba si el empleado tiene turno PUBLICADO **ese día**: sin
 *    cuadrante no hay con qué comparar (igual que el modo estricto de sede
 *    necesita coordenadas de la tienda).
 *  - Ventana admitida: [inicio − margen, fin + margen] de cualquiera de sus
 *    turnos. Con jornada partida (mañana y tarde) vale cualquiera de las dos.
 *  - Turnos nocturnos (fin <= inicio) cruzan medianoche: el fin se lleva al
 *    día siguiente. Por eso se miran también los turnos de ayer y de mañana,
 *    pero esos solo pueden AMPLIAR la ventana admitida, nunca servir para
 *    rechazar un fichaje del día de hoy.
 *
 * La decisión (`evaluarHorarioTurno`) es pura y testeable; la parte que toca
 * BD recibe el cliente Prisma del tenant como dependencia (nunca fetch
 * interno entre rutas — ver AGENTS.md).
 */

import type { PrismaClient } from "@/generated/prisma-tenant/client";

/** Minutos de cortesía a cada lado del turno si el tenant no fija otro. */
export const MARGEN_FICHAJE_DEFAULT = 10;

const MIN_POR_DIA = 1440;

/** Turno del cuadrante ya situado respecto al día de hoy en la zona del tenant. */
export interface TurnoDia {
  /** "HH:MM" */
  horaInicio: string;
  /** "HH:MM" */
  horaFin: string;
  /** Días de diferencia con hoy: -1 ayer, 0 hoy, 1 mañana. */
  offsetDias: number;
}

export type MotivoFueraHorario = "antes" | "despues";

export type EvaluacionHorario =
  /** El empleado no tiene turno publicado cerca: no se comprueba nada. */
  | { estado: "sin_turno" }
  | { estado: "dentro"; turno: TurnoDia }
  | {
      estado: "fuera";
      motivo: MotivoFueraHorario;
      turno: TurnoDia;
      /**
       * Minuto (contado desde la medianoche de HOY en la zona del tenant) al
       * que se ajustaría el fichaje: el inicio del turno si se ficha antes,
       * el fin si se ficha después. Puede ser negativo o pasar de 1440 en
       * turnos que cruzan medianoche.
       */
      ajusteMin: number;
    };

/** "HH:MM" → minutos desde medianoche. Tolerante con formatos sueltos. */
export function hhmmToMin(s: string): number {
  const [h, m] = (s || "0:0").split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

/** Minutos (de cualquier día) → "HH:MM" del reloj. */
export function minToHHMM(min: number): string {
  const norm = ((Math.round(min) % MIN_POR_DIA) + MIN_POR_DIA) % MIN_POR_DIA;
  const h = Math.floor(norm / 60);
  const m = norm % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** Ventana [inicio, fin] del turno en minutos relativos a la medianoche de hoy. */
function ventanaTurno(turno: TurnoDia): { inicio: number; fin: number } {
  const base = turno.offsetDias * MIN_POR_DIA;
  const inicio = base + hhmmToMin(turno.horaInicio);
  let fin = base + hhmmToMin(turno.horaFin);
  // Turno nocturno (22:00 → 06:00): el fin es del día siguiente.
  if (fin <= inicio) fin += MIN_POR_DIA;
  return { inicio, fin };
}

/**
 * ¿Está `ahoraMin` dentro del horario de alguno de los turnos?
 *
 * `ahoraMin` son los minutos transcurridos desde la medianoche de hoy en la
 * zona del tenant. Si queda fuera de todos, devuelve el turno más cercano de
 * los que alcanzan a hoy y a qué minuto habría que ajustar el fichaje.
 *
 * Sin turno de hoy (`offsetDias === 0`) no se comprueba nada, aunque haya
 * turnos ayer o mañana: en un día que el cuadrante no cubre no hay con qué
 * comparar y la jornada no puede bloquearse (RD 8/2019).
 */
export function evaluarHorarioTurno(opts: {
  turnos: TurnoDia[];
  ahoraMin: number;
  margenMin: number;
}): EvaluacionHorario {
  const margen = Math.max(0, opts.margenMin);
  if (!opts.turnos.some((t) => t.offsetDias === 0)) return { estado: "sin_turno" };

  // Turnos que alcanzan al día de hoy: los de hoy, y los de ayer o mañana cuya
  // ventana (con margen) se solapa con hoy —un turno de noche que empezó ayer
  // sigue abierto de madrugada, y uno que mañana empieza a las 00:15 admite
  // fichar esta noche—. El turno de ayer que ya terminó ayer no dice nada del
  // fichaje de hoy: ni lo admite ni puede rechazarlo ni fija su ajuste.
  const relevantes = opts.turnos.filter((t) => {
    if (t.offsetDias === 0) return true;
    const { inicio, fin } = ventanaTurno(t);
    return fin + margen >= 0 && inicio - margen <= MIN_POR_DIA;
  });

  // 1) ¿Cae dentro de la ventana de alguno de esos turnos?
  for (const turno of relevantes) {
    const { inicio, fin } = ventanaTurno(turno);
    if (opts.ahoraMin >= inicio - margen && opts.ahoraMin <= fin + margen) {
      return { estado: "dentro", turno };
    }
  }

  // 2) Fuera de todas: se ajusta al borde más cercano del turno más cercano.
  let mejor: { turno: TurnoDia; distancia: number; motivo: MotivoFueraHorario; ajusteMin: number } | null = null;

  for (const turno of relevantes) {
    const { inicio, fin } = ventanaTurno(turno);
    const antes = opts.ahoraMin < inicio;
    const distancia = antes ? inicio - margen - opts.ahoraMin : opts.ahoraMin - (fin + margen);
    // A igual distancia gana el primero (el turno más temprano del día): el
    // criterio da igual, pero tiene que ser estable para no ofrecer un ajuste
    // distinto en cada intento.
    if (!mejor || distancia < mejor.distancia) {
      mejor = {
        turno,
        distancia,
        motivo: antes ? "antes" : "despues",
        ajusteMin: antes ? inicio : fin,
      };
    }
  }

  return {
    estado: "fuera",
    motivo: mejor!.motivo,
    turno: mejor!.turno,
    ajusteMin: mejor!.ajusteMin,
  };
}

/** Día (YYYY-MM-DD) y minutos del día de un instante, en la zona indicada. */
export function partesEnZona(d: Date, zona: string): { fecha: string; minutos: number } {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: zona,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const p = Object.fromEntries(fmt.formatToParts(d).map((x) => [x.type, x.value]));
  return {
    fecha: `${p.year}-${p.month}-${p.day}`,
    // "24" es la medianoche en algunos locales/motores: normalizamos a 0.
    minutos: (Number(p.hour) % 24) * 60 + Number(p.minute),
  };
}

/** Diferencia en días entre dos fechas "YYYY-MM-DD" (b − a). */
export function diffDias(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000);
}

/** Desfase de la zona respecto a UTC, en minutos, para ese instante. */
function offsetZonaMin(d: Date, zona: string): number {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: zona,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const p = Object.fromEntries(fmt.formatToParts(d).map((x) => [x.type, x.value]));
  const comoUTC = Date.UTC(
    Number(p.year), Number(p.month) - 1, Number(p.day),
    Number(p.hour) % 24, Number(p.minute), Number(p.second),
  );
  return Math.round((comoUTC - Math.floor(d.getTime() / 1000) * 1000) / 60_000);
}

/**
 * Instante real de "el día `diaISO` a `minutosDelDia` minutos" en una zona.
 * `minutosDelDia` puede salirse de [0, 1440) (turnos que cruzan medianoche).
 * Se aplica el offset dos veces para caer del lado correcto en los cambios
 * de hora.
 */
export function instanteEnZona(diaISO: string, minutosDelDia: number, zona: string): Date {
  const [y, m, d] = diaISO.split("-").map(Number);
  const base = Date.UTC(y, m - 1, d) + Math.round(minutosDelDia) * 60_000;
  let ts = base - offsetZonaMin(new Date(base), zona) * 60_000;
  ts = base - offsetZonaMin(new Date(ts), zona) * 60_000;
  return new Date(ts);
}

export type ResultadoHorario =
  | { estado: "sin_turno" }
  | { estado: "dentro"; turno: TurnoDia }
  | {
      estado: "fuera";
      motivo: MotivoFueraHorario;
      turno: TurnoDia;
      /** Instante al que se ajustaría el fichaje (inicio o fin del turno). */
      ajuste: Date;
      /** El mismo instante como "HH:MM", para el texto que ve el empleado. */
      ajusteHora: string;
    };

/**
 * Comprueba si un empleado puede fichar ahora según su cuadrante.
 * Recibe el cliente Prisma del tenant (ya dentro de `runWithTenant`).
 */
export async function evaluarFichajeEnHorario(
  prisma: Pick<PrismaClient, "turno">,
  opts: { userId: string; ahora: Date; margenMin: number; zona: string },
): Promise<ResultadoHorario> {
  const { fecha: hoy, minutos: ahoraMin } = partesEnZona(opts.ahora, opts.zona);

  // Ventana amplia alrededor de hoy: `fecha` se guarda como DateTime y hay
  // que cubrir ayer y mañana por los turnos que cruzan medianoche.
  const ventanaIni = new Date(opts.ahora.getTime() - 36 * 3_600_000);
  const ventanaFin = new Date(opts.ahora.getTime() + 36 * 3_600_000);

  const turnos = await prisma.turno.findMany({
    where: {
      userId: opts.userId,
      estado: "PUBLICADO",
      fecha: { gte: ventanaIni, lte: ventanaFin },
    },
    select: { horaInicio: true, horaFin: true, fecha: true },
  });

  const candidatos: TurnoDia[] = turnos
    .map((t) => ({
      horaInicio: t.horaInicio,
      horaFin: t.horaFin,
      offsetDias: diffDias(hoy, partesEnZona(t.fecha, opts.zona).fecha),
    }))
    .filter((t) => Math.abs(t.offsetDias) <= 1);

  const ev = evaluarHorarioTurno({ turnos: candidatos, ahoraMin, margenMin: opts.margenMin });
  if (ev.estado !== "fuera") return ev;

  return {
    estado: "fuera",
    motivo: ev.motivo,
    turno: ev.turno,
    ajuste: instanteEnZona(hoy, ev.ajusteMin, opts.zona),
    ajusteHora: minToHHMM(ev.ajusteMin),
  };
}

/*
 * Aquí vivía `accionFueraHorario` (ticket b7d3e5a9): decidía qué intento fuera
 * de horario se podía registrar ajustado al borde del turno y cuál se bloqueaba.
 * El ticket c726acd0 retiró el ajuste con un clic, así que ya no hay nada que
 * decidir: fuera de la ventana del turno no se ficha, se solicita.
 */
