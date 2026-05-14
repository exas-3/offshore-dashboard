import { useState, useEffect, useRef, useCallback } from 'react';

const POLL_MS   = 10_000;
const TOAST_TTL = 8_000;
const MIN_DIRTY = 1000;

// ── Web Audio ─────────────────────────────────────────────────────────────────

let _ctx = null;
function audioCtx() {
  if (!_ctx) _ctx = new (window.AudioContext || window.webkitAudioContext)();
  return _ctx;
}

function playTone(type, freqStart, freqEnd, duration, volume) {
  try {
    const ctx  = audioCtx();
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = type;
    osc.frequency.setValueAtTime(freqStart, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(freqEnd, ctx.currentTime + duration * 0.75);
    gain.gain.setValueAtTime(volume, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + duration);
  } catch {}
}

// Tier 1 — 1k–5k DIRTY
function playBuyTier1()  { playTone('sine',     500,  780, 0.22, 0.14); }
function playSellTier1() { playTone('triangle', 480,  310, 0.22, 0.14); }

// Tier 2 — 5k–10k DIRTY
function playBuyTier2()  { playTone('sine',     380,  1100, 0.42, 0.26); }
function playSellTier2() { playTone('triangle', 520,   140, 0.42, 0.26); }

// Tier 3 — 10k+ DIRTY
function playBuyTier3()  { playTone('sine',     260,  1600, 0.75, 0.45); }
function playSellTier3() { playTone('triangle', 600,    60, 0.85, 0.45); }

function tier(amount) {
  if (amount >= 10_000) return 3;
  if (amount >= 5_000)  return 2;
  return 1;
}

function playSound(opType, amount) {
  const t   = tier(amount);
  const buy = opType === 'DEX_BUY';
  if (t === 3) buy ? playBuyTier3()  : playSellTier3();
  else if (t === 2) buy ? playBuyTier2()  : playSellTier2();
  else              buy ? playBuyTier1()  : playSellTier1();
}

// ── hook ─────────────────────────────────────────────────────────────────────

export default function useWhaleAlerts(enabled) {
  const [toasts, setToasts] = useState([]);
  const lastTs = useRef(Math.floor(Date.now() / 1000) - 30);

  const poll = useCallback(async () => {
    if (!enabled) return;
    try {
      const res = await fetch(`/api/dex-activity?since=${lastTs.current}&limit=30`);
      const { activity } = await res.json();
      if (!activity?.length) return;

      const fresh = activity
        .filter(a => a.ts > lastTs.current && a.amount >= MIN_DIRTY);

      if (fresh.length) {
        lastTs.current = activity[0].ts;

        // Play sound for largest event in the batch
        const largest = fresh.reduce((b, a) => a.amount > b.amount ? a : b, fresh[0]);
        playSound(largest.opType, largest.amount);

        const now = Date.now();
        const newToasts = fresh.slice(0, 6).map(a => ({
          id:        a.hash,
          wallet:    a.wallet,
          opType:    a.opType,
          amount:    a.amount,
          hash:      a.hash,
          tier:      tier(a.amount),
          expiresAt: now + TOAST_TTL,
        }));

        setToasts(prev => {
          const seen = new Set(prev.map(t => t.id));
          const deduped = newToasts.filter(t => !seen.has(t.id));
          return [...deduped, ...prev].slice(0, 10);
        });
      } else if (activity.length) {
        lastTs.current = activity[0].ts;
      }
    } catch {}
  }, [enabled]);

  useEffect(() => {
    poll();
    const t = setInterval(poll, POLL_MS);
    return () => clearInterval(t);
  }, [poll]);

  useEffect(() => {
    const t = setInterval(() => {
      setToasts(prev => prev.filter(t => Date.now() < t.expiresAt));
    }, 1000);
    return () => clearInterval(t);
  }, []);

  const dismiss = useCallback((id) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  return { toasts, dismiss };
}
