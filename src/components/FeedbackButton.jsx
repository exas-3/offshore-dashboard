'use client';
import { useState, useRef, useEffect } from 'react';

export default function FeedbackButton() {
  const [open,    setOpen]    = useState(false);
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [status,  setStatus]  = useState(null); // null | 'sending' | 'sent' | 'error'
  const panelRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    function handler(e) {
      if (panelRef.current && !panelRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  async function submit(e) {
    e.preventDefault();
    if (!message.trim()) return;
    setStatus('sending');
    try {
      const r = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject, message }),
      });
      const d = await r.json();
      if (d.ok) {
        setStatus('sent');
        setSubject('');
        setMessage('');
        setTimeout(() => { setStatus(null); setOpen(false); }, 2000);
      } else {
        setStatus('error');
      }
    } catch {
      setStatus('error');
    }
  }

  return (
    <div style={{ position: 'fixed', bottom: 24, right: 24, zIndex: 1000 }} ref={panelRef}>

      {open && (
        <div style={{
          position: 'absolute', bottom: 56, right: 0,
          width: 300, background: 'var(--bg-2)',
          border: '1px solid var(--border-2)', borderRadius: 10,
          padding: '16px', boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
          animation: 'feedbackSlideUp 0.18s ease',
        }}>
          <div style={{ fontSize: 11, color: 'var(--text-2)', letterSpacing: '0.1em', marginBottom: 12 }}>
            LEAVE FEEDBACK
          </div>
          {status === 'sent' ? (
            <div style={{ color: 'var(--green)', fontSize: 13, textAlign: 'center', padding: '16px 0' }}>
              ✓ Sent — thanks!
            </div>
          ) : (
            <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <input
                value={subject}
                onChange={e => setSubject(e.target.value)}
                placeholder="Subject (optional)"
                style={{
                  background: 'var(--bg)', border: '1px solid var(--border-2)',
                  color: 'var(--text)', padding: '7px 10px', borderRadius: 5,
                  fontFamily: 'var(--mono)', fontSize: 11, outline: 'none',
                }}
              />
              <textarea
                value={message}
                onChange={e => setMessage(e.target.value)}
                placeholder="Your message…"
                rows={4}
                required
                style={{
                  background: 'var(--bg)', border: '1px solid var(--border-2)',
                  color: 'var(--text)', padding: '7px 10px', borderRadius: 5,
                  fontFamily: 'var(--mono)', fontSize: 11, outline: 'none',
                  resize: 'vertical',
                }}
              />
              {status === 'error' && (
                <div style={{ color: 'var(--red)', fontSize: 10 }}>Failed to send — try again</div>
              )}
              <button
                type="submit"
                disabled={status === 'sending' || !message.trim()}
                style={{
                  background: 'var(--green)', color: '#000', border: 'none',
                  borderRadius: 5, padding: '8px', fontFamily: 'var(--mono)',
                  fontSize: 11, fontWeight: 700, cursor: 'pointer',
                  opacity: (!message.trim() || status === 'sending') ? 0.5 : 1,
                  letterSpacing: '0.08em',
                }}
              >
                {status === 'sending' ? 'SENDING…' : 'SEND'}
              </button>
            </form>
          )}
        </div>
      )}

      <button
        onClick={() => { setOpen(o => !o); setStatus(null); }}
        title="Leave feedback"
        style={{
          width: 42, height: 42, borderRadius: '50%',
          background: open ? 'var(--green)' : 'var(--bg-2)',
          border: '1px solid var(--border-2)',
          color: open ? '#000' : 'var(--text-2)',
          fontSize: 18, cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
          transition: 'transform 0.15s, background 0.15s, color 0.15s',
        }}
        onMouseEnter={e => e.currentTarget.style.transform = 'scale(1.15)'}
        onMouseLeave={e => e.currentTarget.style.transform = 'scale(1)'}
      >
        💬
      </button>

      <style>{`
        @keyframes feedbackSlideUp {
          from { opacity: 0; transform: translateY(8px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
