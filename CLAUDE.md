# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run build        # compile Next.js (required before every change takes effect)
npm start            # serve production build on :3000
npm run dev          # dev server (hot-reload) — NOT used in production
npm run poller       # start the on-chain indexer: node --env-file=.env server/poller-main.js

# Kill old server and restart after a build
fuser -k 3000/tcp && npm start >> /tmp/offshore-server.log 2>&1 &

# Query the DB directly (for diagnosis)
node --env-file=.env --input-type=module <<'EOF'
import { getDb } from './lib/db.js';
const db = getDb();
const rows = await db`SELECT ...`;
console.log(JSON.stringify(rows));
process.exit(0);
EOF
```

**Important**: The server runs in production mode — `next dev` is not used. Every code change requires `npm run build` followed by a server restart to take effect. There is no hot-reload.

## Architecture

### Two UI layers (legacy vs. active)

- `src/` — the original Vite/React dashboard. Still deployed at `/companies`, `/players`, `/vault`, `/whales` pages (thin wrappers re-exporting from `src/views/`). Uses Recharts.
- `app/_components/offshore.jsx` + `app/_components/terminal.jsx` — the active terminal-style dashboard on `/`. This is where all new work goes.

### Terminal UI system

`design/megaethDashboards/lib/terminal.css` is the CSS design token library — a Bloomberg-style monospace terminal widget vocabulary. It defines CSS custom properties (`--t-fg`, `--t-bg`, `--t-pos`, `--t-neg`, etc.) and layout primitives (`.tm`, `.tm-grid-12`, `.tm-region`, `.tm-kv`, etc.).

`app/_components/terminal.jsx` exports all UI components: `TerminalShell`, `Region`, `KV`, `KVSep`, `BarRow`, `BarRow2`, `StackedBarRow`, `AsciiBarChart`, `Heatmap`, `Toasts`, `Seg`, `Sortable`, `GridCell`, `LineChart`, `fmt`.

`app/_components/offshore.jsx` is the single large dashboard component that assembles all sections using terminal components. It receives the entire `D` data object from the API.

### Data flow

```
MegaETH RPC → server/poller.js → PostgreSQL (Supabase) → app/api/offshore-data/route.js → page.jsx → OffshoreDashboard
```

- The **poller** (`server/poller.js`, entry: `server/poller-main.js`) runs as a separate always-on process. It indexes ERC-20 transfer logs, vault payout events, influence transfers, and company state. Deployed to Fly.io via `fly-poller.toml`.
- The **main API** (`app/api/offshore-data/route.js`) fetches everything in one request, assembles a large JSON blob, and caches it for 30 seconds in-memory. The frontend calls this once on load.
- **Live updates** (`app/api/offshore-data/live/route.js`) are polled every 2.2s by the frontend for real-time block/price/ops counters.

### Database

`lib/db.js` — PostgreSQL via `postgres.js`. **`getDb()` is the export, not `db`**. Usage: `const db = getDb(); const rows = await db\`SELECT ...\``.

`lib/db-sqlite.js` — SQLite fallback (development without `DATABASE_URL`).

`lib/index.js` — single import point that switches between PostgreSQL and SQLite based on `DATABASE_URL`. All API routes import from here.

`lib/idx-queries.js` — queries over `idx_logs` / `idx_contracts`, the raw event index populated by the offshore-indexer service. Uses views: `v_dex_swaps`, `v_vault_cycles`, `v_company_trades`.

Key tables: `transfers`, `vault_payouts`, `influence_transfers`, `supply_snapshots`, `token_holders`, `companies`, `idx_logs`, `meta`.

### On-chain constants (all in `server/etherscan.js`)

- RPC: `https://mainnet.megaeth.com/rpc`
- `DIRTY` = `0xC2f34f8849a8607FD73E06D6849bDA07C2b7DE38` — main game token
- `INFLUENCE` = `0x403De0893f0Bc66139592ba2FD254672f2dB933a` — influence token
- `USDM` = `0xFAfDdBb3FC7688494971A79cC65dca3EF82079E7` — stablecoin
- `VAULT` = `0x955a4adDC17114c36726C12AF9C73E23E497C2BD` — distribution vault
- `GENESIS` = `1_762_797_011` — MegaETH genesis Unix timestamp; `timestamp = block_number + GENESIS` (1 sec/block)

### Transfer classification

Transfers are classified on index into `kind` + `op_type`:
- `MINT` (from zero address) — earning ops: `DRUG_DEAL`, `ARMS_DEAL`, `EXTORTION`, `PARTIAL`, `FAIL`, `SCRAP_ITEM`
- `SPEND` / `BURN` (from user wallet) — spending: `BUY_ASSET`, `LEVEL_UP`, `THIRD_ENTERPRISE`
- `TRANSFER` — DEX activity: `DEX_BUY`, `DEX_SELL`

### Grid layout

The dashboard uses a 12-column CSS grid (`.tm-grid-12`). `GridCell` components have draggable resize handles via `setPointerCapture`. **Paired cells** resize as complements (span + partner = 12) via the `cellPairs` map in `offshore.jsx`. When adding a new cell pair, add both directions to `cellPairs`.

### Vault cycle data

`vault_payouts` stores individual USDm payout claims (one row per claim, each user claims separately). For cycle-level aggregation, fetch raw rows and group in JavaScript using `getCycleStart(ts)` — **never use raw SQL time buckets** as they break on weekends. Cycle rules: weekdays (Mon 09:30 → Sat 09:30 UTC) have 3 cycles/day at 01:30, 09:30, 17:30 UTC (8h each); weekends have 1 cycle/day at 09:30 UTC (24h). The `getCycleStart` function is defined in `app/api/offshore-data/route.js` and `app/api/vault/route.js`.

### Environment

```
DATABASE_URL=postgresql://...  # Supabase connection string (transaction pooler port 6543 for Vercel)
ETHERSCAN_KEY=...               # used by poller for Etherscan-compatible RPC calls
```
