#!/usr/bin/env bash
set -euo pipefail

# Prepara el clon persistente del repo (una vez) y lanza el loop del runner.
# El GH_TOKEN (PAT de la cuenta bot aiabot) autentica git y gh.

# El nombre del directorio del clon NO es indiferente: el hook de time-tracking
# resuelve el proyecto al basename del repo principal del que cuelga el worktree
# del job, así que llamarlo "repo" agruparía las horas de Claudia bajo un
# proyecto llamado "repo" en /agency/time. Mantenerlo como "fichaje".
REPO_DIR="${REPO_DIR:-/home/runner/fichaje}"
REPO_SLUG="${REPO_SLUG:-AgentesIA-MAdrid/empleaia-app}"
BASE_BRANCH="${BASE_BRANCH:-feature/saas-migration}"

git config --global user.name  "${GIT_AUTHOR_NAME:-aiabot}"
git config --global user.email "${GIT_AUTHOR_EMAIL:-aiabot@users.noreply.github.com}"
git config --global credential.helper '!gh auth git-credential'

if [ ! -d "$REPO_DIR/.git" ]; then
  echo "[runner] clonando $REPO_SLUG (rama $BASE_BRANCH) en $REPO_DIR…"
  # Clonamos la RAMA BASE directamente: con --depth sin --branch, gh solo trae
  # la default (main) y `origin/$BASE_BRANCH` no existiría → worktree vacío.
  gh repo clone "$REPO_SLUG" "$REPO_DIR" -- --depth 50 --branch "$BASE_BRANCH"
fi

# Dependencias del repo (una vez) — el worktree por job hardlinkea node_modules.
cd "$REPO_DIR"
git fetch origin "$BASE_BRANCH" --quiet
git checkout -q "origin/${BASE_BRANCH}"
npm ci --no-audit --no-fund

cd /home/runner/app
echo "[runner] arrancando loop (base=${BASE_BRANCH})…"
exec node run-ticket.mjs
