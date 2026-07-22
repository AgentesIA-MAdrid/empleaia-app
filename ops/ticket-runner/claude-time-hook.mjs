#!/usr/bin/env node
/**
 * Hook de time tracking de Claude Code → agency-portal.
 *
 * Claude Code lo invoca en SessionStart / UserPromptSubmit / Stop / SessionEnd
 * (ver install.sh, que lo registra en ~/.claude/settings.json) pasándole por
 * stdin un JSON con session_id, cwd, hook_event_name y transcript_path.
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
import { createReadStream, existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir, hostname, tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const CONFIG_PATH = join(homedir(), '.agentesia-tracker.json');
// Claude Code cachea aquí el % de uso real de los límites (lo que muestra
// `/usage`): { five_hour: { pct, ts }, seven_day: { pct, ts } }.
const RATE_LIMITS_PATH = join(homedir(), '.claude', 'statusline-rate-limits.json');
const SELF = fileURLToPath(import.meta.url);

const EVENT_MAP = {
  SessionStart: 'session_start',
  UserPromptSubmit: 'prompt',
  Stop: 'stop',
  SessionEnd: 'session_end',
};

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

  const payload = {
    event,
    sessionId: hookData.session_id,
    project: resolveProject(hookData.cwd || process.cwd()),
    machine: config.machine || hostname(),
  };

  // Estado de límites (5h / semanal): el % real que muestra `/usage`.
  const rateLimits = readRateLimits();
  if (rateLimits) payload.rateLimits = rateLimits;

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

  // Fire-and-forget: hijo detached que hace el POST y muere en silencio.
  const tmpFile = join(tmpdir(), `agentesia-tracker-${process.pid}-${Date.now()}.json`);
  writeFileSync(tmpFile, JSON.stringify({ url: config.url, key: config.key, payload }));
  const child = spawn(process.execPath, [SELF, '--send', tmpFile], {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
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

/** Nombre del proyecto: carpeta raíz del repo git, o el basename del cwd. */
function resolveProject(cwd) {
  let dir = cwd;
  for (let i = 0; i < 20; i += 1) {
    if (existsSync(join(dir, '.git'))) return basename(dir);
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return basename(cwd) || 'desconocido';
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
