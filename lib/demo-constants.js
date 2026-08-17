// Demo / time-travel constants — client-safe mirror of lib/demo-clock.js.
// NEXT_PUBLIC_* values are inlined at build time; keep them in sync with the
// server-side .env (DEMO_MODE / DEMO_DEFAULT_AT).

export const DEMO = process.env.NEXT_PUBLIC_DEMO === '1';

export const DEMO_START = 1777991880; // 2026-05-05T14:38:00Z
export const DEMO_END   = 1780208280; // 2026-05-31T06:18:00Z

export const DEMO_DEFAULT_AT = (() => {
  const v = Number(process.env.NEXT_PUBLIC_DEMO_DEFAULT_AT);
  const at = Number.isFinite(v) && v > 0 ? v : 1779138900; // 2026-05-18T21:15:00Z
  return Math.min(DEMO_END, Math.max(DEMO_START, Math.floor(at)));
})();

export const GENESIS = 1_762_797_011; // MegaETH: timestamp = block + GENESIS

export function clampAt(ts) {
  return Math.min(DEMO_END, Math.max(DEMO_START, Math.floor(ts)));
}

export function bucketAt(ts, sec = 60) {
  return ts == null ? null : Math.floor(ts / sec) * sec;
}
