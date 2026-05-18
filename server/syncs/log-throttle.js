// Rate-limit log noise: collapse repeated "Rate limit exceeded" errors per
// source into a single "[poller] {name}: N rate-limits in last {window}m" line.
// Other errors print immediately so genuine problems still surface.
//
// Usage: `logSyncError('vault sync', err)` instead of
//        `console.error('[poller] vault sync error:', err.message)`.

const WINDOW_MS = 5 * 60_000;

const counts = new Map(); // name -> { count, firstAt }

function flush(name) {
  const c = counts.get(name);
  if (!c || c.count === 0) return;
  const mins = Math.max(1, Math.round((Date.now() - c.firstAt) / 60_000));
  console.warn(`[poller] ${name}: ${c.count} rate-limit${c.count === 1 ? '' : 's'} in last ${mins}m`);
  counts.delete(name);
}

setInterval(() => { for (const name of counts.keys()) flush(name); }, WINDOW_MS).unref?.();

export function logSyncError(name, err) {
  const msg = err?.message ?? String(err);
  if (/rate limit/i.test(msg)) {
    const c = counts.get(name);
    if (c) c.count++;
    else counts.set(name, { count: 1, firstAt: Date.now() });
    return;
  }
  console.error(`[poller] ${name} error: ${msg}`);
}
