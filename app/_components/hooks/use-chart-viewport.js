'use client';
import { useEffect, useRef, useState } from 'react';

// Viewport state for the criminal-watch chart:
// - default window auto-fits the furthest active endTime near the right edge
// - wheel-zoom scales the span between SPAN_MIN and SPAN_MAX
// - drag-pan shifts the "now" anchor in seconds
//
// Returns { span, xMin, xMax, panSec, userSpan, setUserSpan, setPanSec,
//           resetView, dragRef, attachWheelTo(elementRef) }.

const SPAN_MIN    = 5 * 60;          // 5 min
const SPAN_MAX    = 2 * 60 * 60;     // 2 h
const PAST_FRAC   = 0.4;
const FUTURE_FRAC = 0.6;

export function useChartViewport({ activeOps, now }) {
  const [userSpan, setUserSpan] = useState(null); // null = auto
  const [panSec,   setPanSec]   = useState(0);
  const dragRef = useRef(null);

  const maxEndIn = activeOps.length
    ? Math.max(...activeOps.map(o => Math.max(0, o.endTime - now)))
    : 0;
  const userOverride = userSpan != null || panSec !== 0;

  let xMin, xMax, span;
  if (userOverride) {
    span = userSpan ?? Math.min(SPAN_MAX, Math.max(SPAN_MIN, maxEndIn * 1.4 + 10 * 60));
    const anchor = now + panSec;
    xMin = anchor - span * PAST_FRAC;
    xMax = anchor + span * FUTURE_FRAC;
  } else {
    const futureSec = Math.max(maxEndIn * 1.1, 5 * 60);
    const pastSec   = Math.max(futureSec * PAST_FRAC, 5 * 60);
    span = Math.min(SPAN_MAX, Math.max(SPAN_MIN, futureSec + pastSec));
    xMax = now + futureSec;
    xMin = xMax - span;
  }

  function resetView() { setUserSpan(null); setPanSec(0); }

  return {
    span, xMin, xMax,
    panSec, userSpan, userOverride,
    setUserSpan, setPanSec,
    dragRef, resetView,
  };
}

// Wheel-to-zoom helper hook. React's onWheel is registered passive in
// newer versions so preventDefault() inside onWheel is a no-op — attach
// natively via addEventListener({ passive: false }).
export function useChartWheelZoom(elRef, viewport) {
  useEffect(() => {
    const el = elRef.current;
    if (!el) return;
    const handler = (e) => {
      const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      e.preventDefault();
      e.stopPropagation();
      const factor = delta > 0 ? 1.15 : 1 / 1.15;
      viewport.setUserSpan(prev => {
        const base = prev ?? viewport.span;
        return Math.min(SPAN_MAX, Math.max(SPAN_MIN, base * factor));
      });
    };
    el.addEventListener('wheel', handler, { passive: false, capture: true });
    return () => el.removeEventListener('wheel', handler, { capture: true });
  }, [elRef, viewport.span, viewport.setUserSpan]);
}
