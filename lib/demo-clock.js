// Demo / time-travel clock — server side.
//
// The dashboard can run over a frozen, recorded dataset (DEMO_MODE=1). Every
// API route resolves an "as of" unix timestamp via resolveAsOf(request):
//   - ?at=<unix seconds | ISO-8601>  → clamped into the recorded window
//   - absent + DEMO_MODE             → DEMO_DEFAULT_AT (curated landing moment)
//   - absent + live mode             → null, meaning "real now"
// Query helpers accept a trailing `asOf` param and derive (now, cap) from it
// via nowCap(). cap is a far-future sentinel when live so the SQL predicates
// stay a single code path.

export const DEMO_MODE = process.env.DEMO_MODE === '1';

// Recorded window of the production dataset (transfers/snapshots coverage).
export const DEMO_START = 1777991880; // 2026-05-05T14:38:00Z — first recorded MINT
export const DEMO_END   = 1780208280; // 2026-05-31T06:18:00Z — ingestion stop

export const FAR_FUTURE = 32503680000; // year ~3000 — "no upper bound" sentinel

export function parseAt(raw) {
  if (raw == null || raw === '') return null;
  const s = String(raw).trim();
  if (/^\d{9,12}$/.test(s)) return Number(s);
  const ms = Date.parse(s);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
}

export function clampAt(ts) {
  return Math.min(DEMO_END, Math.max(DEMO_START, Math.floor(ts)));
}

// Curated default landing moment — Season 2 launch evening (ops + hits both
// firing). Override with DEMO_DEFAULT_AT in .env (unix seconds or ISO).
export const DEMO_DEFAULT_AT = (() => {
  const v = parseAt(process.env.DEMO_DEFAULT_AT);
  return v != null ? clampAt(v) : 1779138900; // 2026-05-18T21:15:00Z
})();

// request → asOf (unix seconds) | null ("real now", live path).
export function resolveAsOf(request) {
  try {
    const at = parseAt(new URL(request.url).searchParams.get('at'));
    if (at != null) return clampAt(at);
  } catch { /* no/invalid URL — fall through */ }
  return DEMO_MODE ? DEMO_DEFAULT_AT : null;
}

// Cache key: floor asOf to a bucket so nearby ?at= values share entries.
export function bucketAt(asOf, sec = 60) {
  return asOf == null ? null : Math.floor(asOf / sec) * sec;
}

// (now, cap) pair for query helpers. `now` anchors relative windows; `cap`
// upper-bounds every timestamp predicate (far future when live).
export function nowCap(asOf) {
  const now = asOf ?? Math.floor(Date.now() / 1000);
  return { now, cap: asOf ?? FAR_FUTURE };
}

// Immutable-data cache headers for asOf-scoped responses.
export const DEMO_CACHE_HEADERS = {
  'Cache-Control': 'public, max-age=300, s-maxage=31536000, immutable',
};
