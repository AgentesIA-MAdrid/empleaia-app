#!/usr/bin/env bash
set -euo pipefail

# Prepara el clon persistente del repo (una vez) y lanza el loop del runner.
# El GH_TOKEN (PAT de la cuenta bot aiabot) autentica git y gh.

REPO_DIR="${REPO_DIR:-/home/runner/repo}"
REPO_SLUG="${REPO_SLUG:-AgentesIA-MAdrid/empleaia-app}"
BASE_BRANCH="${BASE_BRANCH:-feature/saas-migration}"

git config --global user.name  "${GIT_AUTHOR_NAME:-aiabot}"
git config --global user.email "${GIT_AUTHOR_EMAIL:-aiabot@users.noreply.github.com}"
git config --global credential.helper '!gh auth git-credential'

if [ ! -d "$REPO_DIR/.git" ]; then
  echo "[runner] clonando $REPO_SLUG en $REPO_DIR…"
  gh repo clone "$REPO_SLUG" "$REPO_DIR" -- --depth 50
fi

# Dependencias del repo (una vez) — el worktree por job hardlinkea node_modules.
cd "$REPO_DIR"
git fetch origin --quiet
git checkout -q "origin/${BASE_BRANCH}" 2>/dev/null || true
npm ci --no-audit --no-fund

cd /home/runner/app
echo "[runner] arrancando loop (base=${BASE_BRANCH})…"
exec node run-ticket.mjs
