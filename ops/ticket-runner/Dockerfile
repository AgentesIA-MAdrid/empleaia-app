# Runner de "Resolver con Claude" (ticketing). Contenedor long-running que
# sondea la cola de jobs, ejecuta Claude Code headless con el prompt del ticket
# en un worktree aislado, y abre un PR. NUNCA mergea. Se despliega como un
# servicio Compose en el Dokploy de empleaIA.

FROM node:22-bookworm-slim

# git (worktrees) + gh (crear PRs) + ca-certs + curl. NO postgresql-client: en
# empleaIA el runner NO accede a BD (Claude resuelve con el prompt + el repo).
RUN apt-get update && apt-get install -y --no-install-recommends \
      git \
      gh \
      ca-certificates \
      curl \
    && rm -rf /var/lib/apt/lists/*

# Claude Code CLI (headless `claude -p`).
RUN npm install -g @anthropic-ai/claude-code

# Usuario no-root: defensa en profundidad (la frontera real es la infra).
RUN useradd -m -u 10001 runner
WORKDIR /home/runner/app

# El clon persistente lo crea el entrypoint con el GH_TOKEN, en
# /home/runner/fichaje. El nombre importa: alimenta el proyecto que reporta el
# time-tracking (basename del repo principal del que cuelga el worktree del job).
RUN mkdir -p /home/runner/fichaje && chown -R runner:runner /home/runner

COPY --chown=runner:runner run-ticket.mjs ./run-ticket.mjs
COPY --chown=runner:runner runner-claude-settings.json ./runner-claude-settings.json
# Hook de time-tracking del agente "Claudia": reporta a /agency/time del portal.
# Copia literal de agency-portal:ops/claude-time-tracker/claude-time-hook.mjs
# (fuente única, otro repo). Al actualizarlo, copiarlo tal cual: el hook reporta
# su HOOK_VERSION y el dashboard avisa si esta copia se queda atrás.
COPY --chown=runner:runner claude-time-hook.mjs ./claude-time-hook.mjs
COPY --chown=runner:runner entrypoint.sh ./entrypoint.sh
RUN chmod +x ./entrypoint.sh

USER runner
ENTRYPOINT ["./entrypoint.sh"]
