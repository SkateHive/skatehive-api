#!/bin/bash
# launchd wrapper for the Skatehive leaderboard recompute job.
#
# launchd runs jobs with a minimal PATH and no shell profile, so this script
# re-establishes a usable environment (node via nvm/homebrew), moves into the
# repo, and runs the recompute via tsx. All output goes to launchd's configured
# log file. Exit code is propagated so launchd/monitoring can see failures.
set -uo pipefail

# Repo root = parent of this script's directory (works regardless of cwd).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_DIR" || { echo "cannot cd to repo dir $REPO_DIR"; exit 1; }

# Make node available under launchd's bare PATH.
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
# Load nvm if the user manages node with it.
if [ -s "$HOME/.nvm/nvm.sh" ]; then
  # shellcheck disable=SC1091
  . "$HOME/.nvm/nvm.sh" >/dev/null 2>&1 || true
fi

if ! command -v node >/dev/null 2>&1; then
  echo "[run-recompute] node not found in PATH ($PATH)"; exit 127
fi

echo "[run-recompute] $(date -u +%FT%TZ) node=$(command -v node) repo=$REPO_DIR"
exec node_modules/.bin/tsx scripts/recompute-leaderboard.ts
