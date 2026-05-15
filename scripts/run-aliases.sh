#!/bin/bash
# Runs all alias-fetching scripts in dependency order.
# New wallets are picked up automatically (all scripts are resumable).
# Add DEBANK_ACCESS_KEY to .env to enable DeBank lookups.
set -e
cd "$(dirname "$0")/.."

log() { echo "[$(date -u '+%Y-%m-%d %H:%M:%S UTC')] $*"; }

log "=== alias run started ==="

log "--- meganames ---"
node --env-file=.env scripts/fetch-meganames.js

log "--- ens ---"
node --env-file=.env scripts/fetch-ens.js

log "--- funders (includes ens for funder candidates) ---"
node --env-file=.env scripts/fetch-funders.js

if grep -q "^DEBANK_ACCESS_KEY=.\+" .env 2>/dev/null; then
  log "--- debank ---"
  node --env-file=.env scripts/fetch-debank.js
else
  log "--- debank skipped (no DEBANK_ACCESS_KEY in .env) ---"
fi

log "=== alias run complete ==="
