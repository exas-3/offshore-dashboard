// Generic "buffer events and flush on a timer" pattern used by every WS
// sync (transfers / liquidations / influence / company-starts).
//
//   const buf = bufferedFlush({
//     label:   'DIRTY',         // used in error logs
//     flushMs: 1500,            // debounce window
//     keyFn:   (e) => e.hash,   // optional, for de-dupe
//     onFlush: async (items) => { ... },
//   });
//   buf.push(item);
//
// push() schedules a flush if one isn't already pending. flush() drains
// immediately and clears the timer. Empty batches don't fire onFlush.

export function bufferedFlush({ label = 'buffer', flushMs = 1500, keyFn, onFlush }) {
  let items = [];
  let timer = null;
  let seen  = keyFn ? new Set() : null;

  async function flushNow() {
    timer = null;
    const batch = items;
    items = [];
    if (seen) seen.clear();
    if (!batch.length) return;
    try {
      await onFlush(batch);
    } catch (err) {
      console.error(`[${label}] flush error:`, err.message);
    }
  }

  return {
    push(item) {
      if (keyFn) {
        const k = keyFn(item);
        if (k != null) {
          if (seen.has(k)) return;
          seen.add(k);
        }
      }
      items.push(item);
      if (!timer) timer = setTimeout(flushNow, flushMs);
    },
    flush: flushNow,
    get size() { return items.length; },
  };
}
