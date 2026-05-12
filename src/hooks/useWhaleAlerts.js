import { useState, useEffect, useRef, useCallback } from 'react';

const POLL_MS   = 15_000;
const TOAST_TTL = 6_000;

// ── Web Audio tones ───────────────────────────────────────────────────────────

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
  } catch { /* AudioContext blocked until user interaction */ }
}

// Buys: rising sine — pitch, duration, and volume scale with size
function playBuySmall()  { playTone('sine', 600,  820, 0.20, 0.12); }  // quick ping
function playBuyMedium() { playTone('sine', 440,  960, 0.38, 0.20); }  // clear chirp
function playBuyLarge()  { playTone('sine', 330, 1400, 0.58, 0.39); }  // whale sweep (+30%)
function playBuyXLarge() { playTone('sine', 260, 1800, 0.80, 0.50); }  // massive pump (+30% of large)

// Sells: falling triangle — deeper and longer with size
function playSellSmall()  { playTone('triangle', 520, 370, 0.22, 0.12); }  // soft drop
function playSellMedium() { playTone('triangle', 500, 210, 0.44, 0.20); }  // clear fall
function playSellLarge()  { playTone('triangle', 540,  95, 0.70, 0.39); }  // deep dump (+30%)
function playSellXLarge() { playTone('triangle', 580,  55, 0.95, 0.50); }  // crash alarm (+30% of large)

function playSoundForEvent(opType, amount) {
  const isBuy = opType === 'DEX_BUY';
  if (isBuy) {
    if (amount <= 200)        playBuySmall();
    else if (amount <= 1000)  playBuyMedium();
    else if (amount <= 10000) playBuyLarge();
    else                      playBuyXLarge();
  } else {
    if (amount <= 200)        playSellSmall();
    else if (amount <= 1000)  playSellMedium();
    else if (amount <= 10000) playSellLarge();
    else                      playSellXLarge();
  }
}

// ── hook ─────────────────────────────────────────────────────────────────────

export default function useWhaleAlerts(enabled) {
  const [toasts, setToasts] = useState([]);
  const lastTs = useRef(Math.floor(Date.now() / 1000) - 60);

  const poll = useCallback(async () => {
    if (!enabled) return;
    try {
      const res  = await fetch(`/api/dex-activity?since=${lastTs.current}&limit=20`);
      const { activity } = await res.json();
      if (!activity?.length) return;

      const fresh = activity.filter(a => a.ts > lastTs.current);
      if (!fresh.length) return;

      lastTs.current = fresh[0].ts - 1;

      // Play sound for the largest event in the batch
      const largest = fresh.reduce((best, a) => a.amount > best.amount ? a : best, fresh[0]);
      playSoundForEvent(largest.opType, largest.amount);

      const now = Date.now();
      const newToasts = fresh.slice(0, 8).map(a => ({
        id:        a.hash,
        wallet:    a.wallet,
        opType:    a.opType,
        amount:    a.amount,
        ts:        a.ts,
        hash:      a.hash,
        expiresAt: now + TOAST_TTL,
      }));

      setToasts(prev => {
        const seen = new Set(prev.map(t => t.id));
        const deduped = newToasts.filter(t => !seen.has(t.id));
        return [...deduped, ...prev].slice(0, 12);
      });
    } catch { /* silent */ }
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
