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

## Watchdog (Fase 7)
Cron de Dokploy cada ~5 min que hace `POST` a
`/api/internal/feedback-ai-job-watchdog` con `Authorization: Bearer $CRON_SECRET`
(rescata jobs zombi). Mismo patrón que el cron de recordatorio de fichaje.
