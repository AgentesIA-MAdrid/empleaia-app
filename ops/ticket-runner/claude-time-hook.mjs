#!/usr/bin/env node
/**
 * Hook de time tracking de Claude Code → agency-portal.
 *
 * Claude Code lo invoca en SessionStart / UserPromptSubmit / Stop / SessionEnd
 * / SubagentStop / PostToolUse (ver install.sh, que lo registra en
 * ~/.claude/settings.json) pasándole por stdin un JSON con session_id, cwd,
 * hook_event_name y transcript_path.
 *
 * Los dos últimos son LATIDOS: sin ellos el hook no emite nada mientras el
 * agente trabaja de forma autónoma, y un turno de una hora con subagentes se
 * contabiliza como un minuto. Van throttleados a HEARTBEAT_MIN_INTERVAL_MS
 * porque PostToolUse se dispara en cada llamada a herramienta.
 *
 * Diseño: el proceso principal lee stdin, construye el payload (incluyendo el
 * parseo de tokens del transcript en Stop/SessionEnd) y se re-lanza a sí mismo
 * en un hijo detached que hace el POST — así el hook devuelve el control a
 * Claude Code en milisegundos y una red lenta o caída nunca bloquea la sesión.
 *
 * Config en ~/.agentesia-tracker.json: { "url": "...", "key": "...", "machine": "..." }
 * Nunca escribe en stdout (en UserPromptSubmit el stdout se inyecta como
 * contexto de la conversación). Sale siempre con código 0.
 */

import { spawn } from 'node:child_process';
import {
  createReadStream,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { homedir, hostname, tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const CONFIG_PATH = join(homedir(), '.agentesia-tracker.json');
// Puenteado por statusline-rate-limits-bridge.sh (el % + resets_at real que
// muestra `/usage`, solo disponible en el input del statusLine command):
// { five_hour: { pct, ts, resets_at? }, seven_day: { pct, ts, resets_at? } }.
// resets_at, si existe, es epoch en segundos.
const RATE_LIMITS_PATH = join(homedir(), '.claude', 'statusline-rate-limits.json');
// Estado de Claude Code: oauthAccount.accountUuid identifica la cuenta logueada.
const CLAUDE_STATE_PATH = join(homedir(), '.claude.json');
const SELF = fileURLToPath(import.meta.url);
// Último latido emitido por sesión: { "<sessionId>": <epochMs> }.
const HEARTBEAT_STATE_PATH = join(homedir(), '.agentesia', 'heartbeats.json');

/**
 * Versión de este hook, reportada en cada payload.
 *
 * El hook es una copia en la máquina de cada persona y solo se actualiza
 * corriendo install.sh; sin esto, una copia vieja pasa desapercibida durante
 * semanas. El dashboard avisa a quien vaya por detrás.
 *
 * SUBIRLA al cambiar el comportamiento del hook, a la vez que
 * EXPECTED_HOOK_VERSION en src/lib/time-tracking/hook-version.ts —
 * hook-version.test.ts falla si se separan.
 */
const HOOK_VERSION = 2;

const EVENT_MAP = {
  SessionStart: 'session_start',
  UserPromptSubmit: 'prompt',
  Stop: 'stop',
  SessionEnd: 'session_end',
  SubagentStop: 'heartbeat',
  PostToolUse: 'heartbeat',
};

/**
 * Cadencia de los latidos. Marca el error máximo al atribuir el final de un
 * turno cuyo `stop` se pierda, así que interesa corto; pero PostToolUse se
 * dispara en cada llamada a herramienta, así que no puede ser tan corto como
 * para inundar el endpoint. 4 minutos deja margen sobrado bajo el gap de
 * inactividad de 15 min del servidor.
 */
const HEARTBEAT_MIN_INTERVAL_MS = 4 * 60 * 1000;

/** Antigüedad a partir de la cual una sesión se poda del fichero de estado. */
const HEARTBEAT_STATE_TTL_MS = 24 * 60 * 60 * 1000;

async function main() {
  if (process.argv[2] === '--send') {
    await sendMode(process.argv[3]);
    return;
  }

  const config = readConfig();
  if (!config) return;

  const input = await readStdin();
  let hookData;
  try {
    hookData = JSON.parse(input);
  } catch {
    return;
  }

  const event = EVENT_MAP[hookData.hook_event_name];
  if (!event || !hookData.session_id) return;

  // Camino rápido de los latidos: PostToolUse se ejecuta en cada llamada a
  // herramienta y no puede añadir latencia perceptible. Descartar aquí, antes
  // de resolver el proyecto (hasta 20 statSync) o leer nada más.
  if (event === 'heartbeat' && !shouldEmitHeartbeat(hookData.session_id)) return;

  const cwd = hookData.cwd || process.cwd();
  if (isTrackingOptedOut(cwd)) return;

  const payload = {
    event,
    sessionId: hookData.session_id,
    project: resolveProject(cwd),
    machine: config.machine || hostname(),
    hookVersion: HOOK_VERSION,
  };

  // Estado de límites (5h / semanal): el % real que muestra `/usage`. Los
  // límites son de la CUENTA activa, no de la persona: si la cuenta logueada
  // está mapeada en config.accountKeys (p. ej. la cuenta compartida del
  // equipo), su % se reporta aparte con la key de esa cuenta.
  const rateLimits = readRateLimits();
  const extraJobs = [];
  if (rateLimits) {
    const accountKey = resolveAccountKey(config);
    if (accountKey && accountKey !== config.key) {
      extraJobs.push({
        url: config.url,
        key: accountKey,
        payload: {
          event: 'rate_limits',
          sessionId: payload.sessionId,
          project: payload.project,
          machine: payload.machine,
          rateLimits,
        },
      });
    } else {
      payload.rateLimits = rateLimits;
    }
  }

  // Tokens: solo en stop/session_end (parsear el transcript en cada prompt
  // sería trabajo inútil; con el cierre de cada turno basta).
  if ((event === 'stop' || event === 'session_end') && hookData.transcript_path) {
    const usage = await parseTranscriptUsage(hookData.transcript_path);
    if (usage && Object.keys(usage).length > 0) payload.usage = usage;
  }

  // Descripción corta de la actividad: el texto del prompt tal cual lo
  // escribió el usuario, truncado. Solo disponible en UserPromptSubmit.
  if (event === 'prompt' && typeof hookData.prompt === 'string' && hookData.prompt.trim()) {
    payload.lastPrompt = truncatePrompt(hookData.prompt.trim());
  }

  // Fire-and-forget: un hijo detached por POST, mueren en silencio.
  const jobs = [{ url: config.url, key: config.key, payload }, ...extraJobs];
  jobs.forEach((job, index) => {
    const tmpFile = join(tmpdir(), `agentesia-tracker-${process.pid}-${Date.now()}-${index}.json`);
    writeFileSync(tmpFile, JSON.stringify(job));
    const child = spawn(process.execPath, [SELF, '--send', tmpFile], {
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
  });
}

/**
 * ¿Toca emitir latido para esta sesión? Throttle a HEARTBEAT_MIN_INTERVAL_MS
 * con el estado en disco, porque cada invocación del hook es un proceso nuevo.
 *
 * Varios subagentes en paralelo pueden leer el mismo estado y emitir a la vez;
 * el rename atómico evita que el fichero se corrompa y un latido de más es
 * inofensivo (el servidor solo mueve last_activity_at).
 */
function shouldEmitHeartbeat(sessionId) {
  const now = Date.now();
  let state = {};
  try {
    const parsed = JSON.parse(readFileSync(HEARTBEAT_STATE_PATH, 'utf8'));
    if (parsed && typeof parsed === 'object') state = parsed;
  } catch {
    // Primera vez, fichero corrupto o ilegible: se reconstruye abajo.
  }

  const last = state[sessionId];
  if (typeof last === 'number' && now - last < HEARTBEAT_MIN_INTERVAL_MS) return false;

  const next = { [sessionId]: now };
  for (const [id, ts] of Object.entries(state)) {
    if (id !== sessionId && typeof ts === 'number' && now - ts < HEARTBEAT_STATE_TTL_MS) {
      next[id] = ts;
    }
  }

  try {
    mkdirSync(dirname(HEARTBEAT_STATE_PATH), { recursive: true });
    const tmpPath = `${HEARTBEAT_STATE_PATH}.${process.pid}.tmp`;
    writeFileSync(tmpPath, JSON.stringify(next));
    renameSync(tmpPath, HEARTBEAT_STATE_PATH);
  } catch {
    // Sin poder persistir el throttle, cada llamada a herramienta emitiría un
    // latido. Callarse es preferible a inundar el endpoint.
    return false;
  }
  return true;
}

/**
 * Key con la que reportar los límites: la de la cuenta de Claude activa si está
 * mapeada en config.accountKeys ({ "<accountUuid>": "<trackerKey>" }), o la
 * personal en caso contrario. Así una cuenta compartida del equipo tiene su
 * propia entrada de límites sea quien sea quien la use.
 */
function resolveAccountKey(config) {
  const accountKeys = config.accountKeys;
  if (!accountKeys || typeof accountKeys !== 'object') return null;
  try {
    const state = JSON.parse(readFileSync(CLAUDE_STATE_PATH, 'utf8'));
    const uuid = state?.oauthAccount?.accountUuid;
    if (typeof uuid === 'string' && typeof accountKeys[uuid] === 'string') {
      return accountKeys[uuid];
    }
  } catch {
    /* sin estado legible: se reporta con la key personal, como siempre */
  }
  return null;
}

async function sendMode(tmpFile) {
  let job;
  try {
    job = JSON.parse(readFileSync(tmpFile, 'utf8'));
  } catch {
    return;
  } finally {
    try { unlinkSync(tmpFile); } catch { /* ya borrado */ }
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    await fetch(new URL('/api/internal/time-ingest', job.url), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-tracker-key': job.key,
      },
      body: JSON.stringify(job.payload),
      signal: controller.signal,
    });
  } catch {
    // Sin red o portal caído: se pierde el heartbeat, no pasa nada.
  } finally {
    clearTimeout(timer);
  }
}

function readConfig() {
  // Fichero (instalación normal en máquina de persona).
  try {
    const raw = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
    if (raw.url && raw.key) return raw;
  } catch {
    /* sin fichero: probamos env vars */
  }
  // Fallback por env vars — pensado para runners headless en contenedor
  // (agentes de feedback), donde es más limpio que montar un fichero.
  const url = process.env.AGENTESIA_TRACKER_URL;
  const key = process.env.AGENTESIA_TRACKER_KEY;
  if (url && key) {
    return { url, key, machine: process.env.AGENTESIA_TRACKER_MACHINE || hostname() };
  }
  return null;
}

/**
 * Lee el % de uso de los límites del fichero de estado de Claude Code. Devuelve
 * null si no existe o no tiene el formato esperado (p. ej. versión antigua que
 * aún no lo genera) — en tal caso simplemente no se reporta.
 */
function readRateLimits() {
  try {
    const raw = JSON.parse(readFileSync(RATE_LIMITS_PATH, 'utf8'));
    const five = raw?.five_hour;
    const seven = raw?.seven_day;
    if (typeof five?.pct !== 'number' || typeof seven?.pct !== 'number') return null;
    const result = {
      fiveHourPct: clampPct(five.pct),
      sevenDayPct: clampPct(seven.pct),
    };
    // ts es epoch en segundos; el más reciente de los dos como muestreo.
    const ts = Math.max(Number(five.ts) || 0, Number(seven.ts) || 0);
    if (ts > 0) result.sampledAt = new Date(ts * 1000).toISOString();
    const fiveResetsAt = Number(five.resets_at);
    if (fiveResetsAt > 0) result.fiveHourResetsAt = new Date(fiveResetsAt * 1000).toISOString();
    const sevenResetsAt = Number(seven.resets_at);
    if (sevenResetsAt > 0) result.sevenDayResetsAt = new Date(sevenResetsAt * 1000).toISOString();
    return result;
  } catch {
    return null;
  }
}

function clampPct(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.min(Math.max(value, 0), 100);
}

function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', () => resolve(''));
    setTimeout(() => resolve(data), 3000).unref();
  });
}

const LAST_PROMPT_MAX_LENGTH = 500;

function truncatePrompt(text) {
  const singleLine = text.replace(/\s+/g, ' ');
  return singleLine.length > LAST_PROMPT_MAX_LENGTH
    ? `${singleLine.slice(0, LAST_PROMPT_MAX_LENGTH - 1)}…`
    : singleLine;
}

/**
 * Opt-out de tracking. Un fichero `.no-tracking` en la raíz del proyecto —o en
 * cualquier directorio por encima— desactiva el reporte entero de esa sesión:
 * ni horas, ni tokens, ni límites, ni resumen de los prompts. Pensado para
 * proyectos en los que el propio nombre de la carpeta ya es información que no
 * debe salir de la máquina.
 *
 * La búsqueda sube hasta la raíz del sistema, así que un `.no-tracking` en el
 * home desactiva el tracking de todos los proyectos de esa máquina.
 */
function isTrackingOptedOut(cwd) {
  let dir = cwd;
  for (let i = 0; i < 20; i += 1) {
    if (existsSync(join(dir, '.no-tracking'))) return true;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return false;
}

/**
 * Nombre del proyecto: carpeta raíz del repo git, o el basename del cwd.
 *
 * En un git worktree, `.git` es un FICHERO con "gitdir: <repo>/.git/worktrees/
 * <nombre>" en vez de un directorio. Sin mirar dentro, el proyecto acabaría
 * siendo el nombre de la carpeta del worktree (es decir, la rama), y varias
 * sesiones paralelas del mismo repo se reportarían como proyectos distintos.
 * Resolvemos al repo principal para que todas cuenten como el mismo proyecto.
 */
function resolveProject(cwd) {
  let dir = cwd;
  for (let i = 0; i < 20; i += 1) {
    const gitPath = join(dir, '.git');
    if (existsSync(gitPath)) {
      const mainRepo = resolveWorktreeMainRepo(gitPath);
      return mainRepo ?? basename(dir);
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return basename(cwd) || 'desconocido';
}

/**
 * Dado un `.git` que sea el fichero de un worktree, devuelve el basename del
 * repo principal; null si es un `.git` normal (directorio) o no se puede leer.
 */
function resolveWorktreeMainRepo(gitPath) {
  try {
    if (!statSync(gitPath).isFile()) return null;
    const match = /^gitdir:\s*(.+?)[/\\]\.git[/\\]worktrees[/\\]/.exec(
      readFileSync(gitPath, 'utf8').trim(),
    );
    return match ? basename(match[1]) : null;
  } catch {
    return null;
  }
}

/**
 * Suma tokens por modelo del transcript JSONL de la sesión (acumulado total).
 * Dedup por message.id + requestId: los retries repiten entradas.
 */
async function parseTranscriptUsage(transcriptPath) {
  if (!existsSync(transcriptPath)) return null;
  const usageByModel = {};
  const seen = new Set();

  const lines = createInterface({
    input: createReadStream(transcriptPath, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });

  for await (const line of lines) {
    if (!line) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    const message = entry?.message;
    const usage = message?.usage;
    const model = message?.model;
    if (!usage || !model || typeof model !== 'string') continue;

    const dedupKey = `${message.id ?? ''}:${entry.requestId ?? ''}`;
    if (dedupKey !== ':' && seen.has(dedupKey)) continue;
    seen.add(dedupKey);

    const bucket = usageByModel[model] ?? {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
    };
    bucket.inputTokens += toCount(usage.input_tokens);
    bucket.outputTokens += toCount(usage.output_tokens);
    bucket.cacheReadTokens += toCount(usage.cache_read_input_tokens);
    bucket.cacheCreationTokens += toCount(usage.cache_creation_input_tokens);
    usageByModel[model] = bucket;
  }

  return usageByModel;
}

function toCount(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
}

main()
  .catch(() => { /* nunca romper la sesión de Claude Code */ })
  .finally(() => process.exit(0));
