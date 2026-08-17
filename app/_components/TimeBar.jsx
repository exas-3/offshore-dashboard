'use client';
import { useEffect, useRef, useState } from 'react';
import { Seg } from './terminal.jsx';
import { DEMO_START, DEMO_END } from '../../lib/demo-constants.js';
import { useVirtualClock, useVirtualNow } from './hooks/use-virtual-clock.js';

// Replay control strip — sits directly under the top ticker in demo mode:
// [● REC MAY 5–31 2026] [datetime] [|◀][−1h][▶/⏸][+1h][▶|] Seg(1×|60×|3600×) [scrubber]

function toLocalInputValue(ts) {
  // datetime-local wants local-time "YYYY-MM-DDTHH:MM"
  const d = new Date(ts * 1000);
  const z = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}T${z(d.getHours())}:${z(d.getMinutes())}`;
}

const btnStyle = {
  background: 'var(--t-bg-soft, transparent)',
  color: 'var(--t-fg)',
  border: '1px solid var(--t-fg-soft)',
  fontFamily: 'var(--t-font)',
  fontSize: 11,
  height: 18,
  padding: '0 7px',
  cursor: 'pointer',
  letterSpacing: '0.05em',
  display: 'inline-flex',
  alignItems: 'center',
};

export function TimeBar() {
  const clock = useVirtualClock();
  const vnow = useVirtualNow(1000);
  // Local text state so typing in the picker doesn't fight the ticking clock.
  // Only an actual edit commits on blur — otherwise focusing the picker while
  // the replay runs would seek back to a stale frozen draft.
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const dirtyRef = useRef(false);

  useEffect(() => {
    if (!editing) setDraft(toLocalInputValue(vnow));
  }, [vnow, editing]);

  if (!clock?.demo) return null;
  const { playing, speed } = clock;

  const commitDraft = (v) => {
    if (dirtyRef.current) {
      const ms = Date.parse(v);
      if (Number.isFinite(ms)) clock.seek(Math.floor(ms / 1000));
    }
    dirtyRef.current = false;
    setEditing(false);
  };

  const fmtRange = 'MAY 5 – 31 2026';
  const utc = new Date(vnow * 1000).toISOString().slice(0, 19).replace('T', ' ');

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8,
      padding: '3px 10px',
      fontFamily: 'var(--t-font)', fontSize: 11,
      color: 'var(--t-fg-soft)',
      borderBottom: '1px solid var(--t-rule)',
      background: 'var(--t-bg-soft, transparent)',
      flexWrap: 'wrap',
    }}>
      <span
        title={`recorded dataset · ${fmtRange} · all boards render as of the selected moment (UTC shown: ${utc})`}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: 'var(--t-neg)', letterSpacing: '0.08em', whiteSpace: 'nowrap' }}
      >
        <span className={playing ? 'tm-blink' : ''}>●</span>
        <b style={{ color: 'var(--t-fg)' }}>{playing ? 'REPLAY' : 'REC'}</b>
        <span style={{ color: 'var(--t-fg-mut)' }}>{fmtRange}</span>
      </span>

      <input
        type="datetime-local"
        value={draft}
        min={toLocalInputValue(DEMO_START)}
        max={toLocalInputValue(DEMO_END)}
        onFocus={() => { setEditing(true); dirtyRef.current = false; }}
        onChange={(e) => { dirtyRef.current = true; setDraft(e.target.value); }}
        onBlur={(e) => commitDraft(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
        style={{
          background: 'transparent',
          border: '1px solid var(--t-rule)',
          color: 'var(--t-fg)',
          fontFamily: 'var(--t-font)',
          fontSize: 11,
          height: 18,
          padding: '0 4px',
          colorScheme: 'dark',
        }}
      />

      <span style={{ display: 'inline-flex', gap: 4 }}>
        <button style={btnStyle} title="jump to window start" onClick={() => clock.seek(DEMO_START)}>|◀</button>
        <button style={btnStyle} title="back 1 hour" onClick={() => clock.seek(vnow - 3600)}>−1h</button>
        <button
          style={{ ...btnStyle, minWidth: 26, justifyContent: 'center', background: playing ? 'var(--t-fg)' : btnStyle.background, color: playing ? 'var(--t-bg)' : 'var(--t-fg)' }}
          title={playing ? 'pause' : 'play'}
          onClick={() => (playing ? clock.pause() : clock.play())}
        >{playing ? '⏸' : '▶'}</button>
        <button style={btnStyle} title="forward 1 hour" onClick={() => clock.seek(vnow + 3600)}>+1h</button>
        <button style={btnStyle} title="jump to window end" onClick={() => clock.seek(DEMO_END)}>▶|</button>
      </span>

      <Seg
        value={playing ? speed : null}
        options={[{ value: 1, label: '1×' }, { value: 60, label: '60×' }, { value: 3600, label: '3600×' }]}
        onChange={(v) => clock.setSpeed(v)}
      />

      <input
        type="range"
        min={DEMO_START}
        max={DEMO_END}
        step={60}
        value={vnow}
        onChange={(e) => clock.seek(Number(e.target.value))}
        title={utc + ' UTC'}
        style={{ flex: 1, minWidth: 120, accentColor: 'var(--t-fg)', height: 14 }}
      />

      <span className="tm-num" style={{ color: 'var(--t-fg)', whiteSpace: 'nowrap' }} title="virtual moment (UTC)">
        {utc} UTC
      </span>
    </div>
  );
}
