/**
 * Arqueos semanales y PIN de recogida — lógica pura (entrega 4).
 *
 * Sin Prisma ni red. Aquí viven las semanas ISO (que son la unidad del arqueo),
 * la validación del PIN y la política de bloqueo por intentos fallidos.
 *
 * Por qué semana ISO y no "los últimos 7 días": el arqueo lo hace una persona
 * un día concreto y tiene que poder decir "esta es la semana del 27 al 2" sin
 * que dependa de cuándo entre en la pantalla. La semana ISO empieza el lunes,
 * que es como cuenta la semana cualquier tienda en España.
 */

export const SEMANA_RE = /^\d{4}-W(0[1-9]|[1-4]\d|5[0-3])$/;

/** Días en milisegundos, para no repetir el número mágico. */
const DIA_MS = 86_400_000;

/**
 * Semana ISO de una fecha, como "YYYY-Www".
 *
 * Ojo con el año: los primeros días de enero pueden pertenecer a la semana 52 o
 * 53 del año anterior (y el 29-31 de diciembre, a la semana 1 del siguiente).
 * El algoritmo es el estándar ISO 8601: se toma el jueves de esa semana y su
 * año es el año ISO.
 */
export function semanaISO(fecha: Date): string {
  const d = new Date(Date.UTC(fecha.getUTCFullYear(), fecha.getUTCMonth(), fecha.getUTCDate()));
  // getUTCDay(): 0 = domingo. En ISO, lunes = 1 … domingo = 7.
  const diaISO = d.getUTCDay() === 0 ? 7 : d.getUTCDay();
  // Nos movemos al jueves de esa semana: define el año ISO.
  d.setUTCDate(d.getUTCDate() + 4 - diaISO);
  const anio = d.getUTCFullYear();
  const inicioAnio = new Date(Date.UTC(anio, 0, 1));
  const semana = Math.ceil(((d.getTime() - inicioAnio.getTime()) / DIA_MS + 1) / 7);
  return `${anio}-W${String(semana).padStart(2, "0")}`;
}

/**
 * Lunes y domingo (ambos inclusive) de una semana ISO, en UTC a medianoche —
 * el mismo formato con el que se guardan las fechas DATE del módulo.
 */
export function rangoSemanaISO(semana: string): { desde: Date; hasta: Date } {
  const [anioStr, semStr] = semana.split("-W");
  const anio = Number.parseInt(anioStr, 10);
  const sem = Number.parseInt(semStr, 10);

  // El 4 de enero cae siempre en la semana 1 (ISO 8601).
  const cuatroEnero = new Date(Date.UTC(anio, 0, 4));
  const diaISO = cuatroEnero.getUTCDay() === 0 ? 7 : cuatroEnero.getUTCDay();
  const lunesSemana1 = new Date(cuatroEnero.getTime() - (diaISO - 1) * DIA_MS);
  const desde = new Date(lunesSemana1.getTime() + (sem - 1) * 7 * DIA_MS);
  const hasta = new Date(desde.getTime() + 6 * DIA_MS);
  return { desde, hasta };
}

export function normalizarSemana(valor: unknown): { ok: true; semana: string } | { ok: false; error: string } {
  const s = typeof valor === "string" ? valor.trim().toUpperCase() : "";
  if (!SEMANA_RE.test(s)) return { ok: false, error: "La semana tiene que venir como AAAA-Wnn." };
  return { ok: true, semana: s };
}

/** Texto de la semana para pantallas y correos: "del 27 de julio al 2 de agosto". */
export function semanaLegible(semana: string): string {
  const { desde, hasta } = rangoSemanaISO(semana);
  const fmt = (d: Date) =>
    new Intl.DateTimeFormat("es-ES", { day: "numeric", month: "long", timeZone: "UTC" }).format(d);
  return `del ${fmt(desde)} al ${fmt(hasta)}`;
}

// ─── PIN de recogida ──────────────────────────────────────────────────────────

export const PIN_MIN = 4;
export const PIN_MAX = 8;
/** Fallos consecutivos antes de bloquear la firma. */
export const PIN_MAX_INTENTOS = 5;
/** Cuánto dura el bloqueo. Temporal: quien recoge está en la tienda. */
export const PIN_BLOQUEO_MINUTOS = 15;

/** PIN demasiado evidente: todos iguales o una secuencia corrida. */
function pinTrivial(pin: string): boolean {
  if (/^(\d)\1+$/.test(pin)) return true;
  const asc = "0123456789";
  const desc = "9876543210";
  return asc.includes(pin) || desc.includes(pin);
}

/**
 * Valida un PIN nuevo. Solo dígitos: se teclea en el móvil de pie en la tienda,
 * y un PIN alfanumérico ahí es una invitación a apuntarlo en un papel.
 */
export function normalizarPin(valor: unknown): { ok: true; pin: string } | { ok: false; error: string } {
  const s = typeof valor === "string" ? valor.trim() : typeof valor === "number" ? String(valor) : "";
  if (!/^\d+$/.test(s)) return { ok: false, error: "El PIN son solo números." };
  if (s.length < PIN_MIN || s.length > PIN_MAX) {
    return { ok: false, error: `El PIN tiene que tener entre ${PIN_MIN} y ${PIN_MAX} dígitos.` };
  }
  if (pinTrivial(s)) {
    return { ok: false, error: "Ese PIN es demasiado evidente (1234, 0000…). Elige otro." };
  }
  return { ok: true, pin: s };
}

export interface EstadoPin {
  intentos: number;
  bloqueoHasta: Date | null;
}

/** ¿Está la firma bloqueada ahora mismo? */
export function pinBloqueado(estado: EstadoPin, ahora: Date = new Date()): boolean {
  return estado.bloqueoHasta !== null && estado.bloqueoHasta.getTime() > ahora.getTime();
}

/** Minutos que quedan de bloqueo, redondeando hacia arriba (para el mensaje). */
export function minutosDeBloqueo(estado: EstadoPin, ahora: Date = new Date()): number {
  if (!pinBloqueado(estado, ahora)) return 0;
  return Math.ceil((estado.bloqueoHasta!.getTime() - ahora.getTime()) / 60_000);
}

/**
 * Nuevo estado del PIN tras un intento fallido. Al llegar al tope se bloquea y
 * el contador vuelve a cero: al vencer el bloqueo se tienen otros tantos
 * intentos, en vez de quedarse bloqueado para siempre a la primera equivocación.
 */
export function trasFalloPin(estado: EstadoPin, ahora: Date = new Date()): EstadoPin {
  const intentos = estado.intentos + 1;
  if (intentos >= PIN_MAX_INTENTOS) {
    return { intentos: 0, bloqueoHasta: new Date(ahora.getTime() + PIN_BLOQUEO_MINUTOS * 60_000) };
  }
  return { intentos, bloqueoHasta: estado.bloqueoHasta };
}

/** Estado tras acertar: se limpia todo. */
export function trasAciertoPin(): EstadoPin {
  return { intentos: 0, bloqueoHasta: null };
}

// ─── Arqueo ───────────────────────────────────────────────────────────────────

/**
 * Efectivo declarado: euros, no negativo. Se admite 0 (una semana sin cobros en
 * efectivo existe, y declararlo es información: alguien lo ha comprobado).
 */
export function normalizarEfectivoArqueo(
  valor: unknown,
): { ok: true; importe: number } | { ok: false; error: string } {
  const bruto =
    typeof valor === "number"
      ? valor
      : typeof valor === "string"
        ? Number.parseFloat(valor.replace(",", "."))
        : Number.NaN;
  if (!Number.isFinite(bruto)) return { ok: false, error: "Escribe un importe válido." };
  if (bruto < 0) return { ok: false, error: "El efectivo no puede ser negativo." };
  if (bruto > 1_000_000) return { ok: false, error: "Ese importe no parece correcto." };
  return { ok: true, importe: Math.round(bruto * 100) / 100 };
}

export type EstadoArqueo = "pendiente" | "recogido";

/**
 * ¿Se puede declarar el arqueo de esta semana? Solo la actual y las pasadas:
 * declarar el efectivo de una semana que aún no ha empezado no significa nada.
 */
export function semanaDeclarable(semana: string, ahora: Date = new Date()): boolean {
  const { desde } = rangoSemanaISO(semana);
  return desde.getTime() <= ahora.getTime();
}
