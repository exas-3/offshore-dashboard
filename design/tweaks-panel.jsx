// Tweaks panel — floating settings overlay for the design mockup.
// Renders a small toggle-able panel in the top-right corner.

(function () {
  const { useState, useEffect, useCallback } = React;

  function useTweaks(defaults) {
    const [t, setT] = useState(() => {
      try {
        const saved = JSON.parse(localStorage.getItem('offshore-tweaks') || '{}');
        return { ...defaults, ...saved };
      } catch { return { ...defaults }; }
    });
    const setTweak = useCallback((k, v) => {
      setT(prev => {
        const next = { ...prev, [k]: v };
        try { localStorage.setItem('offshore-tweaks', JSON.stringify(next)); } catch {}
        return next;
      });
    }, []);
    return [t, setTweak];
  }

  function TweaksPanel({ title = 'Tweaks', children }) {
    const [open, setOpen] = useState(false);
    return (
      <div style={{ position: 'fixed', top: 10, right: 10, zIndex: 9999, fontFamily: 'IBM Plex Mono, monospace', fontSize: 11 }}>
        <button
          onClick={() => setOpen(o => !o)}
          style={{
            background: 'rgba(0,0,0,0.7)', border: '1px solid #ffb00055',
            color: '#ffb000', padding: '3px 8px', cursor: 'pointer',
            fontSize: 11, fontFamily: 'inherit',
          }}
        >
          {open ? '✕' : '⚙'} {title}
        </button>
        {open && (
          <div style={{
            marginTop: 4, background: 'rgba(0,0,0,0.92)',
            border: '1px solid #ffb00044', padding: '8px 12px',
            minWidth: 180, color: '#ffb000',
          }}>
            {children}
          </div>
        )}
      </div>
    );
  }

  function TweakSection({ label }) {
    return (
      <div style={{ color: '#ffb00088', borderTop: '1px solid #ffb00022', margin: '6px 0 4px', paddingTop: 4, fontSize: 10, textTransform: 'uppercase', letterSpacing: 1 }}>
        {label}
      </div>
    );
  }

  function TweakSelect({ label, value, options, onChange }) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
        <span style={{ flex: 1, color: '#ffb00099' }}>{label}</span>
        <select
          value={value}
          onChange={e => onChange(e.target.value)}
          style={{ background: '#111', color: '#ffb000', border: '1px solid #ffb00044', padding: '1px 4px', fontSize: 11, fontFamily: 'inherit' }}
        >
          {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>
    );
  }

  function TweakRadio({ label, value, options, onChange }) {
    return (
      <div style={{ marginBottom: 4 }}>
        <span style={{ color: '#ffb00099', display: 'block', marginBottom: 2 }}>{label}</span>
        <div style={{ display: 'flex', gap: 6 }}>
          {options.map(o => (
            <label key={o.value} style={{ cursor: 'pointer', color: o.value === value ? '#ffb000' : '#ffb00055' }}>
              <input
                type="radio" name={label} value={o.value} checked={o.value === value}
                onChange={() => onChange(o.value)}
                style={{ marginRight: 2 }}
              />
              {o.label}
            </label>
          ))}
        </div>
      </div>
    );
  }

  function TweakToggle({ label, value, onChange }) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
        <span style={{ flex: 1, color: '#ffb00099' }}>{label}</span>
        <button
          onClick={() => onChange(!value)}
          style={{
            background: value ? '#ffb00022' : 'transparent',
            border: `1px solid ${value ? '#ffb000' : '#ffb00044'}`,
            color: value ? '#ffb000' : '#ffb00044',
            padding: '1px 6px', cursor: 'pointer',
            fontSize: 10, fontFamily: 'inherit',
          }}
        >
          {value ? 'ON' : 'OFF'}
        </button>
      </div>
    );
  }

  // Expose to global scope so index.html's App function can use them.
  window.useTweaks    = useTweaks;
  window.TweaksPanel  = TweaksPanel;
  window.TweakSection = TweakSection;
  window.TweakSelect  = TweakSelect;
  window.TweakRadio   = TweakRadio;
  window.TweakToggle  = TweakToggle;
})();
