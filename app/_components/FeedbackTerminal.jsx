'use client';
import { useEffect, useRef, useState } from 'react';

// Slide-up "VSCode terminal"-style feedback panel. Press F2 / click the
// chip in the bottom bar to open. Esc closes. Cmd/Ctrl+Enter sends.
export function FeedbackTerminal({ open, onClose }) {
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [status, setStatus]   = useState(null);  // null | 'sending' | 'ok' | 'err'
  const [error,  setError]    = useState('');
  const taRef = useRef(null);

  // Focus the textarea when opened; reset state when closed.
  useEffect(() => {
    if (open) {
      setStatus(null); setError('');
      const t = setTimeout(() => taRef.current?.focus(), 250); // after slide-in
      return () => clearTimeout(t);
    }
  }, [open]);

  // Esc to close, Cmd/Ctrl+Enter to send.
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); }
      else if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); send(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, subject, message]);

  async function send() {
    if (!message.trim() || status === 'sending') return;
    setStatus('sending'); setError('');
    try {
      const r = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject: subject.trim(), message: message.trim() }),
      });
      const d = await r.json();
      if (!r.ok || !d?.ok) {
        setStatus('err');
        setError(d?.error || 'send failed');
        return;
      }
      setStatus('ok');
      setSubject(''); setMessage('');
      setTimeout(() => onClose(), 700);
    } catch (e) {
      setStatus('err');
      setError(e?.message || 'send failed');
    }
  }

  return (
    <>
      {/* Backdrop — click to close, fades in */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0,
          background: 'rgba(0,0,0,0.35)',
          opacity: open ? 1 : 0,
          pointerEvents: open ? 'auto' : 'none',
          transition: 'opacity 180ms ease',
          zIndex: 1000,
        }}
      />

      {/* Slide-up panel — sits ABOVE the tm-fkeys bottom bar so the
          centred "× close" chip stays visible (acts as a second close
          button at the same position the feedback button was). */}
      <div
        style={{
          position: 'fixed',
          left: 0, right: 0, bottom: 26,  // 26px ≈ height of tm-fkeys
          height: 280,
          background: 'var(--t-bg)',
          borderTop: '1px solid var(--t-rule-hot)',
          boxShadow: '0 -12px 28px rgba(0,0,0,0.4)',
          transform: open ? 'translateY(0)' : 'translateY(calc(100% + 26px))',
          transition: 'transform 220ms cubic-bezier(.2,.7,.2,1)',
          zIndex: 1001,
          display: 'flex',
          flexDirection: 'column',
          fontFamily: 'var(--t-font)',
        }}
      >
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center',
          padding: '6px 12px',
          borderBottom: '1px solid var(--t-rule)',
          fontSize: 'var(--t-fs-sm)',
        }}>
          <span style={{ color: 'var(--t-hdr)' }}>feedback</span>
          <span style={{ color: 'var(--t-fg-soft)', marginLeft: 8 }}>
            — send a note to @0xExas via Telegram
          </span>
          <span style={{ flex: 1 }} />
          <span style={{ color: 'var(--t-fg-mut)', fontSize: 'var(--t-fs-xs)', marginRight: 12 }}>
            esc to close · ⌘/ctrl + enter to send
          </span>
          <span
            role="button"
            onClick={onClose}
            style={{
              cursor: 'pointer',
              color: 'var(--t-fg-soft)',
              padding: '0 6px',
              fontSize: '20px',
              lineHeight: 1,
            }}
          >×</span>
        </div>

        {/* Body */}
        <div style={{ flex: 1, padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 6, minHeight: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ color: 'var(--t-fg-soft)', fontSize: 'var(--t-fs-sm)' }}>$ subject:</span>
            <input
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="(optional)"
              style={{
                flex: 1,
                background: 'transparent',
                border: 'none',
                outline: 'none',
                color: 'var(--t-fg)',
                fontFamily: 'var(--t-font)',
                fontSize: 'var(--t-fs-sm)',
                caretShape: 'block',
                WebkitCaretShape: 'block',
                caretColor: 'var(--t-fg)',
              }}
            />
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6, flex: 1, minHeight: 0 }}>
            <span style={{ color: 'var(--t-fg-soft)', fontSize: 'var(--t-fs-sm)', paddingTop: 2 }}>&gt;</span>
            <textarea
              ref={taRef}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="write your feedback here…"
              style={{
                flex: 1,
                background: 'transparent',
                border: 'none',
                outline: 'none',
                resize: 'none',
                color: 'var(--t-fg)',
                fontFamily: 'var(--t-font)',
                fontSize: 'var(--t-fs-sm)',
                lineHeight: 1.4,
                // Terminal-style wide block caret. CSS Basic UI L4 (Chromium 118+
                // honours `caret-shape`); browsers without support fall back to
                // the default thin I-beam. The default `caret-color` already
                // matches the foreground.
                caretShape: 'block',
                WebkitCaretShape: 'block',
                caretColor: 'var(--t-fg)',
              }}
            />
          </div>
        </div>

        {/* Status bar / submit */}
        <div style={{
          display: 'flex', alignItems: 'center',
          padding: '6px 12px',
          borderTop: '1px solid var(--t-rule)',
          fontSize: 'var(--t-fs-xs)',
        }}>
          <span style={{
            color:
              status === 'ok'      ? 'var(--t-pos)'
            : status === 'err'     ? 'var(--t-neg)'
            : status === 'sending' ? 'var(--t-warn)'
            :                        'var(--t-fg-mut)',
          }}>
            {status === 'sending' ? 'sending…'
            : status === 'ok'     ? 'sent ✓'
            : status === 'err'    ? `error: ${error}`
            : ''}
          </span>
          <span style={{ flex: 1 }} />
          <button
            onClick={send}
            disabled={!message.trim() || status === 'sending'}
            style={{
              background: 'var(--t-fg)',
              color: 'var(--t-bg)',
              border: 'none',
              padding: '4px 14px',
              fontFamily: 'var(--t-font)',
              fontSize: 'var(--t-fs-sm)',
              cursor: !message.trim() || status === 'sending' ? 'not-allowed' : 'pointer',
              opacity: !message.trim() || status === 'sending' ? 0.5 : 1,
            }}
          >send</button>
        </div>
      </div>
    </>
  );
}
