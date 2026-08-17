'use client';
import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { DEMO, DEMO_START, DEMO_END, bucketAt } from '../../../lib/demo-constants.js';

// Virtual clock for demo/replay mode. In live mode the provider runs at 1×
// anchored to the wall clock, so consumers can use virtual time everywhere
// and get real time for free.
//
// Semantics: seek() always pauses (deep links land on a stable frame);
// picking a speed on the Seg starts playback at that speed; pause freezes
// the anchor; playback auto-pauses at the end of the recorded window.

const ClockCtx = createContext(null);

function clampDemo(ts) {
  return DEMO ? Math.min(DEMO_END, Math.max(DEMO_START, ts)) : ts;
}

export function VirtualClockProvider({ initialAt = null, initialSpeed = 0, children }) {
  const [state, setState] = useState(() => ({
    anchorVirtual: clampDemo(initialAt ?? Math.floor(Date.now() / 1000)),
    anchorReal: Date.now(),
    speed: DEMO ? initialSpeed : 1,
    seekNonce: 0,
  }));
  const lastSpeedRef = useRef(initialSpeed > 0 ? initialSpeed : 60);

  const value = useMemo(() => {
    const nowSec = () => clampDemo(Math.floor(
      state.anchorVirtual + ((Date.now() - state.anchorReal) / 1000) * state.speed
    ));
    const reAnchor = (speed, bumpSeek = false) => setState(s => {
      const cur = clampDemo(Math.floor(s.anchorVirtual + ((Date.now() - s.anchorReal) / 1000) * s.speed));
      return { anchorVirtual: cur, anchorReal: Date.now(), speed, seekNonce: s.seekNonce + (bumpSeek ? 1 : 0) };
    });
    return {
      demo: DEMO,
      nowSec,
      playing: state.speed > 0 && DEMO,
      speed: state.speed,
      seekNonce: state.seekNonce,
      seek(ts) {
        setState(s => ({ anchorVirtual: clampDemo(Math.floor(ts)), anchorReal: Date.now(), speed: 0, seekNonce: s.seekNonce + 1 }));
      },
      play(speed) {
        const sp = speed ?? lastSpeedRef.current ?? 60;
        lastSpeedRef.current = sp;
        reAnchor(sp);
      },
      pause() { reAnchor(0); },
      setSpeed(sp) {
        lastSpeedRef.current = sp;
        reAnchor(sp);
      },
    };
  }, [state]);

  // Auto-pause at the end of the recorded window.
  useEffect(() => {
    if (!DEMO || state.speed <= 0) return;
    const t = setInterval(() => {
      const cur = state.anchorVirtual + ((Date.now() - state.anchorReal) / 1000) * state.speed;
      if (cur >= DEMO_END) {
        setState(s => ({ anchorVirtual: DEMO_END, anchorReal: Date.now(), speed: 0, seekNonce: s.seekNonce }));
      }
    }, 500);
    return () => clearInterval(t);
  }, [state]);

  // URL sync (?at=…&speed=…): immediate on pause/seek, throttled while playing.
  useEffect(() => {
    if (!DEMO || typeof window === 'undefined') return;
    const write = () => {
      const now = clampDemo(Math.floor(state.anchorVirtual + ((Date.now() - state.anchorReal) / 1000) * state.speed));
      try {
        const url = new URL(window.location.href);
        url.searchParams.set('at', new Date(now * 1000).toISOString().slice(0, 19) + 'Z');
        // Always write speed — absent means "default (60×)", explicit 0 keeps
        // a shared paused moment frozen on open.
        url.searchParams.set('speed', String(state.speed));
        window.history.replaceState(window.history.state, '', url);
      } catch { /* ignore */ }
    };
    write();
    if (state.speed > 0) {
      const t = setInterval(write, 5_000);
      return () => clearInterval(t);
    }
  }, [state]);

  return <ClockCtx.Provider value={value}>{children}</ClockCtx.Provider>;
}

export function useVirtualClock() {
  return useContext(ClockCtx);
}

// Integer virtual seconds, re-rendering the subscriber at intervalMs of REAL
// time (so countdowns tick once per real second regardless of replay speed).
export function useVirtualNow(intervalMs = 1000) {
  const clock = useContext(ClockCtx);
  const [now, setNow] = useState(() => (clock ? clock.nowSec() : Math.floor(Date.now() / 1000)));
  useEffect(() => {
    const read = () => (clock ? clock.nowSec() : Math.floor(Date.now() / 1000));
    setNow(read());
    const t = setInterval(() => setNow(read()), intervalMs);
    return () => clearInterval(t);
  }, [clock, intervalMs, clock?.seekNonce, clock?.speed]);
  return now;
}

// Query-string fragment for asOf-aware endpoints: 'at=<bucketed>' in demo,
// '' in live mode (so `url + (at ? `?${at}` : '')` composes cleanly).
export function useAtParam(bucketSec = 60) {
  const vnow = useVirtualNow(1000);
  if (!DEMO) return '';
  return `at=${bucketAt(vnow, bucketSec)}`;
}
