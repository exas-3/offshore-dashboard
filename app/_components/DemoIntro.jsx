'use client';
import { useEffect, useState } from 'react';

// Replay-mode welcome modal — shown once per visit (sessionStorage) in demo
// mode. Pure terminal aesthetic: shares the theme tokens, monospace type,
// hard corners, and the REC/replay iconography of the time bar.
export function DemoIntro({ onClose, moment = null }) {
  const [leaving, setLeaving] = useState(false);

  const close = () => {
    setLeaving(true);
    setTimeout(onClose, 180);
  };

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' || e.key === 'Enter') { e.preventDefault(); close(); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const row = (glyph, glyphColor, text) => (
    <div style={{ display: 'flex', gap: 10, alignItems: 'baseline', padding: '5px 0' }}>
      <span style={{ color: glyphColor, width: 16, textAlign: 'center', flex: '0 0 auto' }}>{glyph}</span>
      <span style={{ color: 'var(--t-fg-soft)' }}>{text}</span>
    </div>
  );

  return (
    <div
      onClick={close}
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'color-mix(in srgb, var(--t-bg) 72%, transparent)',
        backdropFilter: 'blur(3px)',
        fontFamily: 'var(--t-font)',
        opacity: leaving ? 0 : 1,
        transition: 'opacity 0.18s ease',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(560px, calc(100vw - 32px))',
          background: 'var(--t-bg)',
          border: '1px solid var(--t-rule-hot, var(--t-rule))',
          boxShadow: '0 0 0 1px var(--t-bg), 0 0 44px color-mix(in srgb, var(--t-fg) 22%, transparent), 0 24px 64px rgba(0,0,0,0.6)',
          transform: leaving ? 'translateY(6px)' : 'none',
          transition: 'transform 0.18s ease',
        }}
      >
        {/* header strip */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '7px 14px',
          borderBottom: '1px solid var(--t-rule)',
          fontSize: 'var(--t-fs-xs)', letterSpacing: '0.12em',
          color: 'var(--t-fg-mut)',
        }}>
          <span className="tm-blink" style={{ color: 'var(--t-neg)' }}>●</span>
          <span style={{ color: 'var(--t-fg)', fontWeight: 700 }}>OFFSHORE</span>
          <span>· community terminal</span>
          <span style={{ marginLeft: 'auto', color: 'var(--t-pos)', fontWeight: 700 }}>REPLAY MODE</span>
        </div>

        <div style={{ padding: '18px 20px 16px' }}>
          <div style={{
            fontSize: 18, fontWeight: 700, letterSpacing: '0.06em',
            color: 'var(--t-fg)', marginBottom: 4,
          }}>
            you're watching a recording<span className="tm-blink" style={{ color: 'var(--t-fg)' }}>▮</span>
          </div>
          <div style={{
            fontSize: 'var(--t-fs-xs)', letterSpacing: '0.14em',
            color: 'var(--t-warn, var(--t-fg-mut))', marginBottom: 14,
          }}>
            RECORDED ON-CHAIN DATA · MAY 5 – 31, 2026 · MEGAETH
          </div>

          <div style={{ fontSize: 'var(--t-fs-sm)', lineHeight: 1.65, color: 'var(--t-fg-soft)', marginBottom: 14 }}>
            The Offshore protocol is paused, so this terminal replays its full
            recorded history — every board, feed and chart renders exactly as it
            stood at the moment on the clock, down to the block and the oracle&#39;s
            ETH price.
          </div>

          <div style={{
            borderTop: '1px dotted var(--t-rule)',
            borderBottom: '1px dotted var(--t-rule)',
            padding: '6px 0', marginBottom: 16,
            fontSize: 'var(--t-fs-sm)',
          }}>
            {row('▸', 'var(--t-pos)', <>press play in the top bar — replay at 1×, 60× or 3600×</>)}
            {row('◆', 'var(--t-warn, var(--t-hdr))', <>drag the timeline or pick any date &amp; time to jump</>)}
            {row('⇗', 'var(--t-hdr)', <>every moment is a shareable link — copy the URL to freeze it</>)}
          </div>

          <button
            onClick={close}
            autoFocus
            style={{
              width: '100%',
              background: 'var(--t-fg)',
              color: 'var(--t-bg)',
              border: '1px solid var(--t-fg)',
              fontFamily: 'var(--t-font)',
              fontSize: 'var(--t-fs-sm)',
              fontWeight: 700,
              letterSpacing: '0.14em',
              padding: '9px 0',
              cursor: 'pointer',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--t-fg)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--t-fg)'; e.currentTarget.style.color = 'var(--t-bg)'; }}
          >
            ENTER THE REPLAY ▸
          </button>
          <div style={{
            textAlign: 'center', marginTop: 8,
            fontSize: 'var(--t-fs-xs)', color: 'var(--t-fg-mut)',
          }}>
            enter / esc{moment ? <> · resuming at <b style={{ color: 'var(--t-fg-soft)' }}>{moment} utc</b></> : null}
          </div>
        </div>
      </div>
    </div>
  );
}
