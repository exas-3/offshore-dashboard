# Legacy one-shot scripts

These were superseded by later iterations or by background poller jobs.
Kept here for archaeology / pattern reference; **don't run them on a
live DB without re-reading what they do**.

| file                              | superseded by                                                       |
|-----------------------------------|----------------------------------------------------------------------|
| `reclassify.mjs`                  | the per-area `reclassify-*` scripts at scripts/                      |
| `reclassify-partials.mjs`         | `scripts/reclassify-partials-v2.mjs` + `server/syncs/partial-sweep.js` |
| `reclassify-busts-with-d47.mjs`   | `server/syncs/transfers.js` storage-slot fallback (D47 deprecated)   |
| `reclassify-bust-ops.mjs`         | same as above                                                        |
| `reclassify-uncovered.mjs`        | `reclassify-partials-v2.mjs`                                         |
| `fix-bad-extortion-rows.mjs`      | better-behaved classifier + sync hardening                           |
| `fix-partial-ops.mjs`             | `reclassify-partials-v2.mjs`                                         |
| `migrate-dex-classification.js`   | direct SQL retag (documented in CLAUDE.md). The original had a typo  |
|                                   | in the main-pool address that meant most rows never got retagged.    |

Active scripts that remain in `scripts/` (current):

- `reclassify-partials-v2.mjs` — backfill for any leftover PARTIAL rows
- `reclassify-lp.mjs` — backfill DEX_BUY/SELL → LP_ADD/LP_REMOVE
- `reclassify-third-enterprise.mjs` — backfill SCRAP→THIRD_ENTERPRISE
- `reclassify-trade-types.mjs` — general trade-type retag template
- `reclassify-misclassified-spends.mjs` — SPEND-classification fixups
- `reclassify-all-game-mints.mjs` — full-sweep MINT reclassification
- `fix-fractional-extortions.mjs` — handle the partial-extortion edge case
- `backfill-*.mjs` — date / dataset-specific historical fills
- alias-fetch chain: `run-aliases.sh`, `fetch-{arkham,debank,ens,meganames,funders}.js`
- `farmer-bot.js` — Telegram feedback bot
- `plausible-setup.sh` — self-hosted analytics setup script
