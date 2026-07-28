# Runner "Resolver con Claude" — despliegue

Contenedor headless que sondea la cola de jobs del ticketing, ejecuta Claude
Code en un worktree aislado y **abre un PR (nunca mergea)**. Se despliega como un
servicio Compose en el Dokploy de empleaIA, **aparte** del app.

## Frontera de seguridad (NO saltar)
- Cuenta bot `aiabot` con **PAT fine-grained** (Contents R/W + PR R/W, solo
  `empleaia-app`, **sin admin/merge**).
- **Ruleset** sobre la rama base (`feature/saas-migration`): require PR + 1
  approval, block force-push, **bypass solo tu equipo (NO el bot)** → el bot abre
  PRs pero no puede mergear ni con su token.
- Worktree efímero, proceso non-root, deny-list de la sesión Claude
  (`runner-claude-settings.json`). En empleaIA el runner **no accede a la BD**.

## Pasos en Dokploy
1. Genera el PAT de `aiabot` (arriba) → `GH_TOKEN`.
2. `claude setup-token` en tu máquina → `CLAUDE_CODE_OAUTH_TOKEN`.
3. Define `EMPLEAIA_SIGNING_SECRET` (un secreto aleatorio) y ponlo **idéntico**
   en el Environment de `empleaia-app` y del runner.
4. Dokploy → nuevo servicio **Compose** → pega `docker-compose.yml`, build
   context `ops/ticket-runner`.
5. Rellena las envs (pestaña Environment) según `env.example`. **Primer deploy
   con `CLAUDE_RUNNER_STUB=1`** → encola un ticket de prueba desde el panel y
   comprueba que sale un PR trivial (claim→PR→callback) sin gastar Claude.
6. Pon `CLAUDE_RUNNER_STUB=0` y prueba un bug real.

## Time-tracking (Claudia en `/agency/time`)

El runner reporta sus horas y tokens al portal de la agencia, donde aparece como
el técnico **Claudia** sobre el proyecto `fichaje`. Piezas:

- `claude-time-hook.mjs` — **copia literal** de
  `agency-portal:ops/claude-time-tracker/claude-time-hook.mjs` (fuente única, en
  otro repo). Al actualizarla, copiar el fichero tal cual sin editarlo; el hook
  reporta su `HOOK_VERSION` y el dashboard avisa si esta copia se queda atrás.
- `runner-claude-settings.json` — registra el hook en los 6 eventos
  (`SessionStart`, `UserPromptSubmit`, `Stop`, `SessionEnd`, `SubagentStop`,
  `PostToolUse`). Los dos últimos son los **latidos**: sin ellos, un job de
  media hora se contabilizaría como un minuto.
- `AGENTESIA_TRACKER_URL` / `AGENTESIA_TRACKER_KEY` en el Environment del
  servicio. Sin key, el hook no envía nada y Claudia no sale en el dashboard.
- La key tiene que estar dada de alta en `TIME_TRACKER_KEYS` del portal como
  `claudia:<key>` (una entrada más junto a dani/borja/manu) → redeploy del portal.
- `REPO_DIR` se llama `/home/runner/fichaje` **a propósito**: el hook resuelve el
  proyecto al basename del repo principal del que cuelga el worktree del job, así
  que un nombre genérico (`repo`) crearía un proyecto llamado "repo".

Verificar la key desde cualquier máquina:

```bash
curl -s -X POST -m 5 \
  -H "x-tracker-key: LA_KEY_DE_CLAUDIA" \
  -H "content-type: application/json" \
  -d '{"event":"prompt","sessionId":"test-manual","project":"fichaje"}' \
  https://app.agentesialabs.com/api/internal/time-ingest
# → {"ok":true,"member":"claudia",...}   401 = la key no está en TIME_TRACKER_KEYS
```

En headless normalmente **no** se reporta el % de límites (no hay statusLine que
genere `~/.claude/statusline-rate-limits.json`): Claudia sale en tiempo y tokens,
pero no en la columna "Límites".

## Por qué Claudia no monta entorno (28-jul-2026)

Los jobs empezaron a morir en masa con `timeout: claude excedió 1800000ms`.
La causa no era el modelo ni la cuenta: **Claudia levantaba un Postgres
embebido y arrancaba la app dentro del contenedor** para poder verificar y
hacer la captura que le pedía el prompt. Lo que se veía en el contenedor:

- `@embedded-postgres/linux-x64/native/bin/postgres` + `postgres: io worker`
- `@prisma/cli-dev@latest/.../@prisma/dev`, `node /tmp/pgserver.mjs`
- `curl -H "Host: dev.localhost"` contra la app
- 1,3 GB en `/tmp` por job, **RAM 2,6 GiB de 3 GiB**, CPU 200 %

Consecuencias en cadena: el job agotaba sus 30 min sin escribir código; al
matarlo, el `SIGKILL` iba solo a `claude` y los nietos quedaban huérfanos
asfixiando al job siguiente; y con el runner ahogado el watchdog lo declaraba
zombi, tras lo cual el runner **latía en bucle** contra un job ya fallido
(`409 transición inválida fallido → ejecutando`) sin liberarse.

Qué se cambió:

- **Prompt** (`src/lib/feedback/claude-prompt.ts` y el `--append-system-prompt`
  del runner): prohibido levantar Postgres, arrancar la app, usar docker y
  correr `npm run build`; fuera la exigencia de captura. La verificación es
  estática (`lint`, `tsc --noEmit`, `vitest` en lógica pura) y lo que necesite
  prueba en caliente se revisa al mergear el PR.
- **`runner-claude-settings.json`**: deny de `docker`, `postgres`, `pg_ctl`,
  `initdb`, `next dev`, `npm run dev`, `prisma dev`, `npm run build`. Red de
  seguridad, no la defensa principal.
- **`run-ticket.mjs`**: `spawn` con `detached: true` y el timeout mata el
  **grupo** de procesos (`kill(-pid)`), no solo a `claude`; el latido detecta
  el 409 y **abandona** el job en vez de insistir; y cada job barre los restos
  de `/tmp` de los anteriores.

Si un ticket necesita de verdad probarse contra una BD, eso no va aquí: se
revisa a mano sobre el PR.

## Watchdog (Fase 7)
Cron de Dokploy cada ~5 min que hace `POST` a
`/api/internal/feedback-ai-job-watchdog` con `Authorization: Bearer $CRON_SECRET`
(rescata jobs zombi). Mismo patrón que el cron de recordatorio de fichaje.
