// Máquina de estados PURA de los jobs de "Resolver con Claude". Sin BD ni
// entorno: decide dedupe (canEnqueue) y transiciones válidas (applyJobEvent).
// La tabla feedback_ai_jobs y los wrappers de repositorio se apoyan en esto.
// Portado de TuFacturaIA tal cual (es agnóstico de Supabase/Prisma).

export type JobStatus =
  | "encolado"
  | "ejecutando"
  | "pr_abierto"
  | "desplegado"
  | "sin_cambios"
  | "fallido";

/** Estados en los que el job sigue vivo (ocupa la cola). */
export const LIVE_STATES: readonly JobStatus[] = ["encolado", "ejecutando"];

/** Estados terminales: el job acabó, se puede re-encolar el ticket. */
export const TERMINAL_STATES: readonly JobStatus[] = ["pr_abierto", "desplegado", "sin_cambios", "fallido"];

/**
 * ¿Se puede encolar un job nuevo para un ticket dado su último job?
 * Bloquea si hay uno vivo (dedupe); permite si no hay o el último es terminal.
 */
export function canEnqueue(latest: { status: JobStatus } | null): boolean {
  if (!latest) return true;
  return !LIVE_STATES.includes(latest.status);
}

export type JobTransition =
  | { ok: true; next: JobStatus }
  | { ok: false; reason: string };

/** Transiciones permitidas desde cada estado (excluida la idempotencia). */
const ALLOWED: Record<JobStatus, readonly JobStatus[]> = {
  encolado: ["ejecutando", "fallido"],
  // `ejecutando → encolado` es la vuelta a la cola cuando el trabajo no se ha
  // podido ni intentar: hoy solo por cuota agotada de Claude (429). No es un
  // fallo del ticket —el runner no llegó a leer una línea de código— y quemarlo
  // como `fallido` obligaba a relanzarlo a mano y dejaba en el panel un error
  // que no explicaba nada. El runner que reencola se duerme hasta que la cuota
  // vuelve, así que esto no es un bucle: es una espera.
  ejecutando: ["pr_abierto", "sin_cambios", "fallido", "encolado"],
  // pr_abierto → desplegado lo dispara el webhook de GitHub al mergear el PR.
  pr_abierto: ["desplegado"],
  desplegado: [],
  sin_cambios: [],
  fallido: [],
};

/**
 * Aplica un evento del runner (estado destino reportado) al estado actual.
 * Idempotente: reportar el mismo estado terminal que ya tiene es un no-op ok
 * (el callback puede llegar dos veces). Rechaza saltos inválidos.
 */
export function applyJobEvent(current: JobStatus, event: JobStatus): JobTransition {
  if (current === event) return { ok: true, next: current };
  if (ALLOWED[current].includes(event)) return { ok: true, next: event };
  return { ok: false, reason: `transición inválida ${current} → ${event}` };
}
