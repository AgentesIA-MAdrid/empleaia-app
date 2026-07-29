// Runner de "Resolver con Claude" (ticketing). Portado de TuFacturaIA y
// adaptado a empleaIA: secreto EMPLEAIA_SIGNING_SECRET, repo empleaia-app,
// rama base configurable (BASE_BRANCH, default feature/saas-migration), y SIN
// acceso a BD (Claude resuelve solo con el prompt + el código del repo).
//
// Loop: reclama el siguiente job encolado → worktree aislado desde la rama base
// → Claude Code headless con el prompt → gate lint+typecheck → abre PR (draft si
// el gate falla) o reporta sin_cambios → callback. NUNCA mergea.
//
// La frontera de seguridad es la infra: GH_TOKEN del bot sin bypass del ruleset
// (require PR+approval; el bot no puede mergear ni con su PAT), worktree efímero,
// non-root, deny-list de la sesión Claude. Este orquestador solo hace
// `gh pr create`, jamás `gh pr merge`.

import { createHmac, createHash } from "node:crypto";
import { spawnSync, spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, cpSync, existsSync, readdirSync, symlinkSync, lstatSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, basename } from "node:path";

const APP_BASE_URL = required("APP_BASE_URL");
const SIGNING_SECRET = required("EMPLEAIA_SIGNING_SECRET");
// Ojo: el basename alimenta el proyecto del time-tracking (ver entrypoint.sh).
const REPO_DIR = process.env.REPO_DIR || "/home/runner/fichaje";
const REPO_SLUG = process.env.REPO_SLUG || "AgentesIA-MAdrid/empleaia-app";
const BASE_BRANCH = process.env.BASE_BRANCH || "feature/saas-migration";
const CLAUDE_MODEL = process.env.CLAUDE_MODEL || "opus";
const POLL_INTERVAL = Number(process.env.POLL_INTERVAL_MS || 15_000);
const JOB_TIMEOUT = Number(process.env.JOB_TIMEOUT_MS || 30 * 60_000);
const HEARTBEAT_MS = Number(process.env.HEARTBEAT_MS || 60_000);
const STUB = process.env.CLAUDE_RUNNER_STUB === "1";

function required(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`[runner] falta env ${name}`);
    process.exit(1);
  }
  return v;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── HMAC service-auth (espejo de src/lib/internal/auth.ts, formato v2) ───────
function signedHeaders(method, pathWithSearch, body) {
  const t = Math.floor(Date.now() / 1000);
  const bodyHash = createHash("sha256").update(body ?? "").digest("hex");
  const payload = `${t}.${method}.${pathWithSearch}.${bodyHash}`;
  const v1 = createHmac("sha256", SIGNING_SECRET).update(payload).digest("hex");
  return { "content-type": "application/json", "x-service-signature": `t=${t},v1=${v1}` };
}

async function apiPost(pathWithSearch, bodyObj) {
  const body = JSON.stringify(bodyObj ?? {});
  const res = await fetch(`${APP_BASE_URL}${pathWithSearch}`, {
    method: "POST",
    headers: signedHeaders("POST", pathWithSearch, body),
    body,
  });
  const json = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, json };
}

function run(cmd, args, opts = {}) {
  return spawnSync(cmd, args, { encoding: "utf8", ...opts });
}

/**
 * Latido del job. Devuelve "ajeno" si el backend responde 409: significa que
 * el job ya no está en `ejecutando` (el watchdog lo rescató por zombi), así
 * que insistir no sirve de nada y hay que abandonar el trabajo en curso.
 */
async function heartbeat(jobId) {
  try {
    const r = await callback(jobId, "ejecutando", {}, { retry: false });
    return r && r.status === 409 ? "ajeno" : "ok";
  } catch {
    return "ok"; // best-effort: un fallo de red no justifica tirar el job
  }
}

async function progress(jobId, phase, detail) {
  try {
    await apiPost(`/api/internal/feedback-ai-job/${jobId}/progress`, { phase, detail });
  } catch {
    /* best-effort */
  }
}

// Traduce una llamada a herramienta de Claude a una línea legible para el panel.
function describeTool(name, input = {}) {
  const raw = input.file_path || input.path || input.notebook_path || "";
  // Recorta a partir de la carpeta raíz conocida para que quepa y se lea bien.
  const m = raw.match(/(?:^|\/)((?:src|ops|prisma|public|scripts|docs)\/.*)$/);
  const f = m ? m[1] : raw;
  switch (name) {
    case "Read": return f ? `Leyendo ${f}` : "Leyendo un fichero";
    case "Edit":
    case "Write":
    case "NotebookEdit": return f ? `Editando ${f}` : "Editando un fichero";
    case "Bash": return `Ejecutando: ${(input.command || "").replace(/\s+/g, " ").slice(0, 90)}`;
    case "Grep": return `Buscando "${(input.pattern || "").slice(0, 60)}"`;
    case "Glob": return `Listando ${(input.pattern || "").slice(0, 60)}`;
    case "Task": return `Subagente: ${(input.description || "").slice(0, 60)}`;
    case "TodoWrite": return "Planificando los pasos…";
    case "WebFetch":
    case "WebSearch": return "Consultando documentación";
    default: return name ? `Usando ${name}` : "";
  }
}

function runClaudeHeartbeat(jobId, args, opts) {
  return new Promise((resolve) => {
    const child = spawn("claude", args, { ...opts });
    let stdout = "";
    let stderr = "";
    // Acumuladores del parseo NDJSON (--output-format stream-json):
    let lineBuf = "";        // resto de línea incompleta entre chunks
    let resultText = "";     // texto final (evento {type:"result"})
    let assistantText = "";  // fallback: concatenación de bloques de texto
    let lastProgressAt = 0;  // throttle suave del POST de progreso

    function handleLine(line) {
      const s = line.trim();
      if (!s) return;
      let ev;
      try { ev = JSON.parse(s); } catch { return; } // líneas no-JSON: ignorar
      if (ev.type === "assistant" && Array.isArray(ev.message?.content)) {
        for (const block of ev.message.content) {
          if (block.type === "text" && typeof block.text === "string") {
            assistantText += block.text + "\n";
          } else if (block.type === "tool_use") {
            const detail = describeTool(block.name, block.input || {});
            const now = Date.now();
            if (detail && now - lastProgressAt > 800) {
              lastProgressAt = now;
              void progress(jobId, "analizando", detail);
            }
          }
        }
      } else if (ev.type === "result" && typeof ev.result === "string") {
        resultText = ev.result;
      }
    }

    if (child.stdout) child.stdout.on("data", (d) => {
      const chunk = d.toString();
      stdout += chunk;
      lineBuf += chunk;
      let idx;
      while ((idx = lineBuf.indexOf("\n")) >= 0) {
        const line = lineBuf.slice(0, idx);
        lineBuf = lineBuf.slice(idx + 1);
        handleLine(line);
      }
    });
    if (child.stderr) child.stderr.on("data", (d) => { stderr += d.toString(); });
    let timedOut = false;
    let abandonado = false;
    // Mata el ÁRBOL entero (grupo de procesos). Matar solo a `claude` dejaba
    // huérfanos vivos —Postgres embebido, prisma dev— comiendo la RAM del
    // contenedor y asfixiando a los jobs siguientes.
    const matarArbol = () => {
      try { process.kill(-child.pid, "SIGKILL"); }
      catch { try { child.kill("SIGKILL"); } catch { /* ya muerto */ } }
    };
    const hb = setInterval(() => {
      void heartbeat(jobId).then((estado) => {
        // 409 = el job ya no es nuestro (el watchdog lo dio por zombi).
        // Seguir latiendo era un bucle infinito que ni liberaba el runner ni
        // mataba el trabajo en curso.
        if (estado === "ajeno" && !abandonado) {
          abandonado = true;
          console.error(`[runner] job ${jobId} ya no es nuestro (409): abortando el trabajo en curso`);
          matarArbol();
        }
      });
    }, HEARTBEAT_MS);
    const killer = setTimeout(() => { timedOut = true; matarArbol(); }, JOB_TIMEOUT);
    const finish = (code, extraErr) => {
      clearInterval(hb); clearTimeout(killer);
      if (lineBuf.trim()) handleLine(lineBuf); // última línea sin \n
      // Texto final para parseClaudeOutput: result event → fallback a textos
      // del assistant → fallback al stdout crudo (modo print legacy).
      const finalText = resultText || assistantText.trim() || stdout;
      resolve({ code, stdout, stderr: extraErr ? `${stderr}\nspawn error: ${extraErr}` : stderr, timedOut, abandonado, finalText });
    };
    child.on("error", (err) => finish(null, err.message));
    child.on("close", (code) => finish(code));
  });
}

function parseClaudeOutput(stdout) {
  const text = (stdout || "").trim();
  const reDiag = /\[DIAGN[ÓO]STICO\]/i;
  const reRes = /\[RESUMEN\]/i;
  const mRes = text.match(reRes);
  if (!mRes) return { diagnostico: text, resumen: "" };
  const resumen = text.slice(mRes.index + mRes[0].length).trim();
  let diagnostico = text.slice(0, mRes.index);
  const mDiag = diagnostico.match(reDiag);
  if (mDiag) diagnostico = diagnostico.slice(mDiag.index + mDiag[0].length);
  return { diagnostico: diagnostico.trim(), resumen: resumen.trim() };
}

async function uploadAfterScreenshot(jobId, wt) {
  const localPath = join(wt, "feedback-after.png");
  if (!existsSync(localPath)) return null;
  try {
    const buf = readFileSync(localPath);
    if (buf.byteLength > 5 * 1024 * 1024) { console.error("[runner] feedback-after.png > 5MB, se omite"); return null; }
    const r = await apiPost(`/api/internal/feedback-ai-job/${jobId}/screenshot`, {
      image_base64: buf.toString("base64"),
      content_type: "image/png",
      ext: "png",
    });
    if (!r.ok) { console.error(`[runner] upload captura "después" HTTP ${r.status}`); return null; }
    return r.json?.path ?? null;
  } catch (e) {
    console.error("[runner] upload captura \"después\" falló:", e?.message || e);
    return null;
  }
}

/**
 * Borra restos de jobs anteriores en /tmp. Un job matado a mitad puede dejar
 * cientos de MB (datadirs de Postgres embebido, cachés de prisma dev) que el
 * contenedor arrastra hasta reiniciarse.
 */
function limpiarRestos(actual) {
  try {
    for (const nombre of readdirSync(tmpdir())) {
      if (nombre === basename(actual)) continue;
      if (!/^(ticket-|@prisma$|pgserver)/.test(nombre)) continue;
      try { rmSync(join(tmpdir(), nombre), { recursive: true, force: true }); } catch { /* noop */ }
    }
  } catch { /* noop */ }
}

async function processJob({ job, prompt }) {
  const id8 = job.id.slice(0, 8);
  const branch = `fix/ticket-${id8}`;
  const wt = mkdtempSync(join(tmpdir(), `ticket-${id8}-`));
  limpiarRestos(wt);

  try {
    run("git", ["-C", REPO_DIR, "fetch", "origin", "--quiet"]);
    run("git", ["-C", REPO_DIR, "worktree", "add", "-B", branch, wt, `origin/${BASE_BRANCH}`]);
    // node_modules se COMPARTE por symlink, no se copia. Copiarlo eran 1,3 GB
    // y ~75.000 ficheros por job con `cpSync`: minutos del presupuesto, disco
    // de sobra gastado y, sobre todo, fallos intermitentes con
    // `EINTR, Interrupted system call` — una copia síncrona tan larga la
    // interrumpe cualquier señal que reciba el proceso y Node la propaga.
    // El worktree solo necesita leerlos (lint, tsc, vitest); escribir en ellos
    // está fuera de lo que puede hacer el job (deny de npm install/ci).
    // Si el enlace falla por lo que sea, se cae a la copia de siempre.
    const nmOrigen = join(REPO_DIR, "node_modules");
    if (existsSync(nmOrigen)) {
      try {
        symlinkSync(nmOrigen, join(wt, "node_modules"), "dir");
      } catch (e) {
        console.error(`[runner] symlink de node_modules falló (${e?.message}); copiando`);
        cpSync(nmOrigen, join(wt, "node_modules"), { recursive: true, verbatimSymlinks: true });
      }
    }
    // Los clientes Prisma generados (`src/generated/prisma*`) están en
    // .gitignore, así que un worktree recién creado NO los tiene y `tsc` saca
    // errores de tipos falsos (todo lo que venga de Prisma queda `unknown`).
    // Generarlos aquí, una vez y en <1 s, hace que la verificación del job y
    // el gate del runner sirvan de algo desde el primer momento, en vez de
    // depender de que Claude se dé cuenta y los genere por su cuenta.
    const genMaster = run("npx", ["--no-install", "prisma", "generate"], { cwd: wt });
    const genTenant = run("npx", ["--no-install", "prisma", "generate", "--config", "prisma.config.tenant.ts"], { cwd: wt });
    if (genMaster.status !== 0 || genTenant.status !== 0) {
      console.error(`[runner] prisma generate falló (master=${genMaster.status}, tenant=${genTenant.status}); el gate puede dar falsos positivos`);
    }
    await progress(job.id, "preparando", `Worktree aislado listo desde origin/${BASE_BRANCH}`);

    let diagnostico = "";
    let resumen = "";

    if (STUB) {
      writeFileSync(join(wt, ".stub-touch"), `job ${job.id}\n`);
      run("git", ["-C", wt, "add", "-A"]);
      run("git", ["-C", wt, "commit", "-q", "-m", `chore: stub runner ${id8}`]);
    } else {
      await progress(job.id, "analizando", "Claude analizando el ticket…");
      const settings = join(REPO_DIR, "..", "app", "runner-claude-settings.json");
      const append =
        `Resuelve este ticket de soporte siguiendo el prompt al pie de la letra. Reglas INVIOLABLES: ` +
        `trabaja solo en este worktree; si hay fix, deja los cambios commiteados en la rama ${branch}; ` +
        `NO abras PR tú (lo hace el runner); NUNCA hagas git push --force ni gh pr merge; ` +
        `corre \`npm run lint\` y \`npx tsc --noEmit\` antes de dar por bueno el cambio (NO corras build: ` +
        `revienta por OOM en el contenedor y CI ya lo verifica); AUDITA tu propio diff antes de terminar ` +
        `(causa raíz, sin regresiones, inviolables de CLAUDE.md y AGENTS.md: withTenant/withTenantPage, ` +
        `prismaApp vs prismaMaster, no-legacy-prisma, NO fetch interno entre rutas). ` +
        `PROHIBIDO montar entorno de ejecución: NO levantes Postgres (ni embedded-postgres, ni ` +
        `\`prisma dev\`, ni initdb/pg_ctl), NO arranques la app (\`next dev\`, \`npm run dev\`, ` +
        `servidores propios) y NO uses docker ni curl contra la app. En este contenedor no hay entorno: ` +
        `hacerlo consume los ${Math.round(JOB_TIMEOUT / 60000)} min del job, agota su RAM y el trabajo se ` +
        `pierde entero. Tu verificación es estática: \`npm run lint\`, \`npx tsc --noEmit\` y, si tocas ` +
        `lógica pura, \`npx vitest run <fichero>\`. Tampoco intentes hacer capturas de pantalla. ` +
        `Lo que necesite prueba en caliente se revisa al mergear el PR: dilo en el [DIAGNÓSTICO]. ` +
        `MUY IMPORTANTE — alcance: distingue si el ticket es un BUG puntual o una MEJORA / funcionalidad ` +
        `nueva. Si pide una mejora o funcionalidad, IMPLÉMENTALA COMPLETA aunque sea grande, toque varios ` +
        `archivos o requiera modelo/migración/API/UI nuevos; NO la reduzcas a un arreglo menor de un ` +
        `síntoma, NO te limites a diagnosticar y NO cierres en falso. Si el ticket pide varias cosas, ` +
        `cúbrelas TODAS; si algo queda fuera, dilo explícitamente en el [RESUMEN]. La regla de "no ` +
        `inventes cambios / deja el worktree limpio" aplica SOLO si el ticket no es accionable, no se ` +
        `entiende, o ya está implementado — NUNCA como excusa para no hacer lo que se pide. ` +
        `TERMINA SIEMPRE con los dos bloques [DIAGNÓSTICO] (técnico, para el equipo) y [RESUMEN] (para el ` +
        `cliente, trato de tú, sin jerga): es OBLIGATORIO, el sistema los separa por esos marcadores.`;
      const cl = await runClaudeHeartbeat(job.id, [
        "-p", prompt,
        "--model", CLAUDE_MODEL,
        "--dangerously-skip-permissions",
        // stream-json (+ --verbose, obligatorio en print mode) hace que Claude
        // emita NDJSON por stdout: cada tool_use se traduce a un evento de
        // progreso visible en el panel. El texto final se recupera del evento
        // {type:"result"} (ver runClaudeHeartbeat → finalText).
        "--output-format", "stream-json",
        "--verbose",
        "--append-system-prompt", append,
        ...(existsSync(settings) ? ["--settings", settings] : []),
      ], { cwd: wt, env: { ...process.env }, detached: true });
      if (cl.abandonado) {
        // El watchdog ya lo marcó fallido; cualquier callback nuestro daría 409.
        console.error(`[runner] job ${job.id} abandonado (ya resuelto por el watchdog)`);
        return;
      }
      if (cl.timedOut) {
        await callback(job.id, "fallido", { error: `timeout: claude excedió ${JOB_TIMEOUT}ms` });
        return;
      }
      if (cl.code !== 0) {
        await callback(job.id, "fallido", {
          error: `claude salió con código ${cl.code}: ${(cl.stderr || cl.stdout || "").slice(0, 3000)}`,
        });
        return;
      }
      const parsed = parseClaudeOutput(cl.finalText);
      diagnostico = parsed.diagnostico;
      resumen = parsed.resumen;
    }

    await heartbeat(job.id);
    const resumenAdjuntoPath = STUB ? null : await uploadAfterScreenshot(job.id, wt);

    const outcome = {
      ...(diagnostico ? { diagnostico: diagnostico.slice(0, 10000) } : {}),
      ...(resumen ? { resumen: resumen.slice(0, 5000) } : {}),
      ...(resumenAdjuntoPath ? { resumen_adjunto_path: resumenAdjuntoPath } : {}),
    };

    const porcelain = (run("git", ["-C", wt, "status", "--porcelain"]).stdout || "").trim();
    const ahead = (run("git", ["-C", wt, "rev-list", "--count", `origin/${BASE_BRANCH}..HEAD`]).stdout || "").trim();
    const hasChanges = porcelain.length > 0 || (ahead !== "" && ahead !== "0");

    if (!hasChanges) {
      await callback(job.id, "sin_cambios", outcome);
      return;
    }

    await progress(job.id, "verificando", "Verificando el cambio: lint · typecheck");
    let gateGreen = true;
    let gateLog = "";
    // Lint SOLO de los archivos que tocó Claudia (git diff vs la base), no el
    // lint global: el repo arrastra deuda de lint preexistente en tests/utils
    // que no debe teñir de rojo un PR correcto (si no, todos salían en draft).
    const changed = (run("git", ["-C", wt, "diff", "--name-only", `origin/${BASE_BRANCH}...HEAD`]).stdout || "")
      .split("\n")
      .map((s) => s.trim())
      .filter((f) => /\.(ts|tsx)$/.test(f) && existsSync(join(wt, f)));
    if (changed.length > 0) {
      const r = run("npx", ["eslint", ...changed], { cwd: wt });
      if (r.status !== 0) {
        gateGreen = false;
        gateLog = `$ eslint <archivos cambiados> (exit ${r.status})\n${((r.stdout || "") + (r.stderr || "")).trim().slice(-2000)}`;
      }
    }
    // Typecheck global con tsc (NO `npm run typecheck`: ese script no existe).
    // Regeneramos antes ambos clientes Prisma por si el PR tocó el schema.
    if (gateGreen) {
      run("npx", ["prisma", "generate", "--schema", "prisma/schema.prisma"], { cwd: wt });
      run("npx", ["prisma", "generate", "--schema", "prisma/schema-tenant.prisma"], { cwd: wt });
      const r = run("npx", ["tsc", "--noEmit"], { cwd: wt });
      if (r.status !== 0) {
        gateGreen = false;
        gateLog = `$ npx tsc --noEmit  (exit ${r.status})\n${((r.stdout || "") + (r.stderr || "")).trim().slice(-2000)}`;
      }
    }

    await progress(job.id, "subiendo", gateGreen ? "Gate verde — subiendo la rama y abriendo PR…" : "Gate en rojo — PR en draft…");
    const push = run("git", ["-C", wt, "push", "-u", "origin", branch, "--force-with-lease", "--no-verify"]);
    if (push.status !== 0) {
      await callback(job.id, "fallido", { branch, error: `git push falló (exit ${push.status}): ${(push.stderr || push.stdout || "").slice(0, 3500)}` });
      return;
    }

    const prArgs = [
      "pr", "create", "--repo", REPO_SLUG, "--base", BASE_BRANCH, "--head", branch,
      "--title", `fix(ticket): ${id8}`,
      "--body", `Resuelto por el runner "Resolver con Claude" (ticket ${job.ticket_id}).` +
        (gateGreen ? "" : `\n\n⚠️ Gate lint/typecheck FALLÓ — PR en draft, revisar.\n\n\`\`\`\n${gateLog}\n\`\`\``),
      ...(gateGreen ? [] : ["--draft"]),
    ];
    const pr = run("gh", prArgs, { cwd: wt });
    const prUrl = (pr.stdout || "").trim().split("\n").pop();
    if (pr.status !== 0 || !/^https?:\/\//.test(prUrl || "")) {
      await callback(job.id, "fallido", { branch, error: `gh pr create falló (exit ${pr.status}): ${(pr.stderr || pr.stdout || "").slice(0, 3500)}` });
      return;
    }
    await callback(job.id, "pr_abierto", { pr_url: prUrl, branch, ...outcome });
  } catch (e) {
    await callback(job.id, "fallido", { error: String(e?.message || e).slice(0, 4000) });
  } finally {
    // Quitar el enlace de node_modules ANTES de borrar el worktree: si algo
    // siguiera el symlink al limpiar, se llevaría por delante el
    // node_modules del clon persistente y el runner se quedaría sin
    // dependencias. `unlinkSync` borra el enlace, nunca su destino.
    try {
      const nmLink = join(wt, "node_modules");
      if (lstatSync(nmLink).isSymbolicLink()) unlinkSync(nmLink);
    } catch { /* no existía o no era enlace */ }
    run("git", ["-C", REPO_DIR, "worktree", "remove", "--force", wt]);
    try { rmSync(wt, { recursive: true, force: true }); } catch { /* noop */ }
  }
}

const RETRYABLE_STATUS = new Set([404, 408, 425, 429, 500, 502, 503, 504]);
const CALLBACK_RETRY_DELAYS_MS = [1000, 2000, 5000, 10000];

/**
 * Devuelve `{ status }` para que quien llama pueda reaccionar al código HTTP.
 * Lo usa el latido: un 409 significa que el job ya no está en `ejecutando` y
 * hay que abandonarlo, en vez de reintentar cada minuto para siempre.
 */
async function callback(jobId, event, extra, { retry = true } = {}) {
  const path = `/api/internal/feedback-ai-job/${jobId}/callback`;
  const maxRetries = retry ? CALLBACK_RETRY_DELAYS_MS.length : 0;
  let lastInfo = "";
  let lastStatus = 0;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const r = await apiPost(path, { event, ...extra });
      lastStatus = r.status;
      if (r.ok) return { ok: true, status: r.status };
      lastInfo = `${r.status}`;
      if (!RETRYABLE_STATUS.has(r.status)) {
        console.error(`[runner] callback ${event} falló (no reintentable): ${r.status}`, r.json);
        return { ok: false, status: r.status };
      }
    } catch (e) {
      lastInfo = String(e?.message || e);
    }
    if (attempt < maxRetries) {
      const delay = CALLBACK_RETRY_DELAYS_MS[attempt];
      console.error(`[runner] callback ${event} fallo transitorio (${lastInfo}); reintento ${attempt + 1}/${maxRetries} en ${delay}ms`);
      await sleep(delay);
    }
  }
  console.error(`[runner] callback ${event} ${retry ? "AGOTÓ reintentos" : "falló"}: ${lastInfo}`);
  return { ok: false, status: lastStatus };
}

async function main() {
  console.log(`[runner] arrancado (stub=${STUB}, model=${CLAUDE_MODEL}, base=${BASE_BRANCH}, poll=${POLL_INTERVAL}ms)`);
  for (;;) {
    try {
      const claim = await apiPost("/api/internal/feedback-ai-job/claim", {});
      const job = claim.ok ? claim.json?.job : null;
      const jobId = job && typeof job.id === "string" && job.id ? job.id : null;
      if (jobId && claim.json?.prompt) {
        console.log(`[runner] job ${jobId} reclamado`);
        await processJob(claim.json);
        continue;
      }
      if (jobId && !claim.json?.prompt) {
        await callback(jobId, "fallido", { error: "ticket no encontrado" });
        continue;
      }
    } catch (e) {
      console.error("[runner] error en el ciclo:", e?.message || e);
    }
    await sleep(POLL_INTERVAL);
  }
}

main();
