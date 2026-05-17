# CLAUDE.md

This file provides guidance to Claude Code when working with this repository.

## Commands

```bash
npm run build        # compile Next.js
npm start            # serve production build on :3000
npm run dev          # dev server with hot-reload
npm run poller       # start the on-chain indexer: node --env-file=.env server/poller-main.js

# Kill old server and restart after a build
fuser -k 3000/tcp && npm start >> /tmp/offshore-server.log 2>&1 &

# Query the DB directly
node --env-file=.env --input-type=module <<'EOF'
import { getDb } from './lib/db.js';
const db = getDb();
const rows = await db`SELECT ...`;
console.log(JSON.stringify(rows));
process.exit(0);
EOF
```

Production runs on a Hetzner VPS. Two always-on processes run side by side:
- **Next.js** (`npm start`) — web server + API routes
- **Poller** (`npm run poller`) — on-chain indexer

## Architecture

### Active vs. legacy code

- `app/` — active. All new work goes here.
- `src/` — legacy Vite/React frontend. Still serves the sub-pages (companies, monitor, players, whales, vault). Do not delete, but don't add new features here.
- `server/poller.js` + `server/etherscan.js` + `server/poller-main.js` — active poller code.
- `scripts/farmer-bot.js` — active Telegram monitor bot.
- `scripts/fetch-*.js` + `scripts/run-aliases.sh` — alias enrichment pipeline (`npm run aliases`).
- `scripts/` — one-time migration/fix/backfill scripts. Leave in place for reference.

### Data flow

```
MegaETH RPC
  └─ server/poller.js (15s intervals)
       ├─ transfers, influence_transfers, vault_payouts
       ├─ supply_snapshots, eth_price_snapshots, price_snapshots
       ├─ token_holders (every 15min)
       └─ companies (every 2min)

offshore-indexer (separate repo, runs locally)
  └─ idx_logs, idx_contracts → views: v_dex_swaps, v_vault_cycles, v_company_trades

PostgreSQL (localhost:5432/offshore_dashboard)
  └─ app/api/offshore-data/route.js (30s in-memory cache)
       └─ app/page.jsx
            ├─ fetches /api/offshore-data once on load
            └─ polls /api/offshore-data/live every 2.2s (block, prices, recent ops)
```

### Terminal UI

`design/megaethDashboards/lib/terminal.css` — Bloomberg-style CSS design tokens (`--t-fg`, `--t-bg`, `--t-pos`, `--t-neg`, etc.) and layout primitives (`.tm`, `.tm-grid-12`, `.tm-region`, `.tm-kv`).

`app/_components/terminal.jsx` — component library: `TerminalShell`, `Region`, `KV`, `KVSep`, `BarRow`, `BarRow2`, `StackedBarRow`, `AsciiBarChart`, `Heatmap`, `Toasts`, `Seg`, `Sortable`, `GridCell`, `LineChart`, `fmt`.

`app/_components/offshore.jsx` — single large component that assembles all dashboard sections. Receives the full `D` data object from the API.

### Grid layout

12-column CSS grid (`.tm-grid-12`). `GridCell` has draggable resize handles via `setPointerCapture`. Paired cells resize as complements (span + partner = 12) via the `cellPairs` map in `offshore.jsx`. When adding a new cell pair, register both directions in `cellPairs`.

### Database

`lib/db.js` — PostgreSQL via `postgres.js`. **Export is `getDb()`, not `db`**.  
Usage: `const db = getDb(); const rows = await db\`SELECT ...\``.

`lib/index.js` — re-exports everything from `lib/db.js` and `lib/idx-queries.js`. All API routes import from here.

`lib/idx-queries.js` — queries over `idx_logs` / `idx_contracts` written by the offshore-indexer service. Views: `v_dex_swaps`, `v_vault_cycles`, `v_company_trades`, `v_v3_swaps`.

Key tables: `transfers`, `vault_payouts`, `influence_transfers`, `supply_snapshots`, `eth_price_snapshots`, `influence_supply_snapshots`, `token_holders`, `companies`, `staking_deposits`, `meta`, `idx_logs`, `idx_contracts`.

### On-chain constants (`lib/chain-constants.js`)

Single source of truth, re-exported by `server/etherscan/constants.js` and `lib/db/connection.js`. Do **not** duplicate addresses elsewhere.

```
RPC:             https://mainnet.megaeth.com/rpc  (1 sec/block)
GENESIS:         1_762_797_011   (Unix ts of block 0; timestamp = block_number + GENESIS)

DIRTY:           0xC2f34f8849a8607FD73E06D6849bDA07C2b7DE38  — main game token
INFLUENCE:       0x403De0893f0Bc66139592ba2FD254672f2dB933a  — influence token
USDM:            0xFAfDdBb3FC7688494971A79cC65dca3EF82079E7  — stablecoin
VAULT:           0x955a4adDC17114c36726C12AF9C73E23E497C2BD  — distribution vault
FACTORY:         0x619814A203cA441611cEE02aBF31986Ca265dd35  — company factory
BATCH_RESOLVER:  0x6E43F31b2c160A3672C681114696667Ef219D4C3  — batch state reader
STAKING:         0x3620bbEDED3BcF1b3409098Dc152b0EEcf66eA8e  — FactionStaking (ERC1967Proxy, impl 0x5787Da81ab8e0be376029302e3950076e5c772c2)
  Staked(address indexed user, uint256 indexed rotationId, uint256 amount)
  topic0: 0x1449c6dd7851abc30abf37f57715f492010519147cc2652fbc38202c18a6ee90

DEX pools:
  0xf9f676066eb7baeeed93e859bc26a41663f277a8  main pool
  0x6bd9eef21c2419feffafbf4850153a3b3a74a5e1  legacy V3 pool
```

Price feeds come from the Kumbaya exchange API, not on-chain reads.

### Transfer classification

Classified at index time into `kind` + `op_type` by **destination-first** logic in `server/etherscan/classification.js`:

| kind | trigger | op_types |
|------|---------|----------|
| `MINT` | from = `0x0` | `DRUG_DEAL`, `ARMS_DEAL`, `EXTORTION`, `PARTIAL`, `SCRAP`, `FAIL` (legacy) |
| `SPEND` / `BURN` | to = `0x0` (selector-aware) | `BUY_ASSET`, `LEVEL_UP`, `THIRD_ENTERPRISE`, `BURN` |
| `TRANSFER` | DEX pool involved | `DEX_BUY`, `DEX_SELL` |
| `TRANSFER` | staking contract involved | `STAKE_DEPOSIT`, `STAKE_WITHDRAW` |
| `TRANSFER` | else | `TRANSFER` (P2P) |

Selector-based SPEND only fires when the Transfer's destination is the zero address — otherwise the row falls through to a TRANSFER classification. This avoids the old bug where any DIRTY transfer inside a `levelUp()`/`buyAsset()` tx was tagged SPEND regardless of where the tokens went.

**MINT op_type resolution for game ops:** uses the factory's D47 (OpResult) event topic `0xd47648dbe7...`, **not** the company `tradeType()` selector (`0x6fd47b44`) — that selector returns 2 for every company and produced ~30% mis-tagging historically. `word0` of D47's data is 750/250/80 for drug/arms/extortion. `fetchFactoryTradeContext` returns a `d47TxMap` keyed by tx hash for sync paths to consume.

**`result` column on `transfers`** (text, values `'completed' | 'busted' | NULL`):
- populated for MINTs of `DRUG_DEAL`/`ARMS_DEAL`/`EXTORTION`
- `completed` ⟺ amount ∈ {100, 115, 130}; everything else (including the ~7-DIRTY consolation refund for busts) is `'busted'`

### Company trade type

`companies.trade_type` (text) stores the current trade's type, resolved from on-chain storage slots:
- slot 4 = trade start ts, slot 5 = trade end ts
- duration = slot5 − slot4 → `300s = EXTORTION`, `1800s = ARMS_DEAL`, `5400s = DRUG_DEAL`

`syncCompanies` (every 2 min) refreshes this for active companies via `getCompanyTradeTypesFromStorage`. The upsert uses `COALESCE(EXCLUDED.trade_type, companies.trade_type)` so a failed RPC read never clobbers a good cached value.

The live "ongoing crimes" route reads `c.trade_type` directly. **Do not** join to `transfers.op_type` keyed by the owner — multiple companies per owner give incorrect tags.

### Vault cycle data

`vault_payouts` stores individual claims (one row per user claim). For cycle-level aggregation, group in JavaScript using `getCycleStart(ts)` — **never use raw SQL time buckets**, they break on weekends.

Cycle rules:
- **Weekdays** (Mon 09:30 → Sat 09:30 UTC): 3 cycles/day, 8h each, starting at 01:30 / 09:30 / 17:30 UTC
- **Weekends** (Sat 09:30 → Mon 09:30 UTC): 1 cycle/day, 24h

`getCycleStart` is defined in `app/api/offshore-data/route.js` and `app/api/vault/route.js`.

### Environment

```
DATABASE_URL=postgres://sir:sir_local@localhost:5432/offshore_dashboard
ETHERSCAN_KEY=...      # MegaETH RPC key (used by poller)
TG_BOT_TOKEN=...       # Telegram bot (feedback)
TG_CHAT_ID=...         # Telegram chat ID
```
