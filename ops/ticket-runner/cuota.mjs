// Lectura de por qué ha muerto una ejecución de Claude, sin efectos: la usa
// `run-ticket.mjs` para decidir entre marcar el job `fallido` o devolverlo a la
// cola. Vive aparte para poder probarla (`cuota.test.mjs`), porque el error que
// costó el ticket #0091 fue precisamente confundir un límite de cuota con un
// fallo del ticket y enseñar en el panel el mensaje equivocado.

/** Cómo se llama en castellano cada límite que reporta el CLI. */
export const TIPO_LIMITE = {
  seven_day: "límite semanal",
  five_hour: "límite de 5 horas",
  opus_weekly: "límite semanal de Opus",
};

export const PAUSA_MIN_MS = 5 * 60_000;
export const PAUSA_MAX_MS = 60 * 60_000;

/** Fecha y hora en Madrid, para que el motivo se lea sin traducir epochs. */
export function fechaLegible(ms) {
  try {
    return new Date(ms).toLocaleString("es-ES", {
      timeZone: "Europe/Madrid",
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return new Date(ms).toISOString();
  }
}

/**
 * ¿Ha muerto por cuota agotada y no por algo del ticket? El CLI lo dice de dos
 * maneras y basta una: el evento `result` con `api_error_status: 429`, o un
 * `rate_limit_event` cuyo estado ya viene rechazado (con el overage
 * deshabilitado en la organización no hay ni reintento posible).
 *
 * Importa distinguirlo porque no es un fallo: el job no ha llegado a leer una
 * línea de código, así que merece volver a la cola en vez de morir.
 *
 * Devuelve null si la muerte es por cualquier otra causa.
 */
export function limiteDeCuota(cl) {
  const rl = cl?.rateLimit ?? null;
  const rechazado = !!rl && (rl.status === "rejected" || rl.overageStatus === "rejected");
  if (cl?.apiErrorStatus !== 429 && !rechazado) return null;
  return {
    tipo: (rl && TIPO_LIMITE[rl.rateLimitType]) || "límite de uso",
    // El CLI da el reset en segundos epoch; dentro se maneja en milisegundos.
    resetsAt: rl && typeof rl.resetsAt === "number" ? rl.resetsAt * 1000 : null,
  };
}

/** El aviso que se escribe en el job y se enseña en el panel. */
export function avisoDeCuota(cuota) {
  const cuando = cuota.resetsAt ? `el ${fechaLegible(cuota.resetsAt)}` : "en un rato";
  return (
    `Sin cuota de Claude (${cuota.tipo}); vuelve ${cuando}. ` +
    `El ticket se queda en la cola y se reintenta solo, no hace falta relanzarlo.`
  );
}

/**
 * Cuánto esperar antes de volver a reclamar. Nunca menos de 5 minutos (para no
 * convertir la vuelta a la cola en un bucle caliente) y nunca más de una hora,
 * no por desconfiar del `resetsAt` sino para volver a preguntar de vez en
 * cuando: la cuota puede ampliarse antes de lo anunciado.
 */
export function msDePausa(cuota, ahora = Date.now()) {
  const espera = cuota?.resetsAt ? cuota.resetsAt - ahora : PAUSA_MIN_MS;
  return Math.min(PAUSA_MAX_MS, Math.max(PAUSA_MIN_MS, espera));
}

/**
 * El motivo de una muerte que no es de cuota, en algo que se pueda leer en el
 * panel. El texto útil viaja en el evento `result` (stdout, NDJSON); stderr
 * suele traer solo warnings, y quedarse con él era lo que hacía que un error de
 * verdad llegase al panel disfrazado de aviso de stdin.
 */
export function motivoDeMuerte(cl) {
  const partes = [
    cl?.apiErrorStatus ? `HTTP ${cl.apiErrorStatus}` : "",
    (cl?.resultText || "").trim(),
    (cl?.stderr || "").trim(),
  ].filter(Boolean);
  const detalle = partes.join(" · ") || (cl?.stdout || "").trim() || "sin salida";
  return `claude salió con código ${cl?.code}: ${detalle.slice(0, 3000)}`;
}
