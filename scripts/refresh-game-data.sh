#!/usr/bin/env bash
# Hourly refresh of game leaderboard + behavioral labels.
#
# 1. fetch-game-leaderboard.mjs → upserts wallet_aliases.alias from Supabase
# 2. label-wallets.mjs         → recomputes extractor/contributor/neutral
#
# Run via cron every hour. Logs to /tmp/offshore-refresh.log.
set -euo pipefail
cd "$(dirname "$0")/.."

LOG=/tmp/offshore-refresh.log
echo "=== $(date -u +'%Y-%m-%dT%H:%M:%SZ') ===" >> "$LOG"

npm run --silent fetch-game-leaderboard  >> "$LOG" 2>&1
npm run --silent label-wallets           >> "$LOG" 2>&1
npm run --silent backfill-influence-daily >> "$LOG" 2>&1

# Keep the log small — last 5000 lines is plenty for debugging recent runs.
tail -5000 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"
