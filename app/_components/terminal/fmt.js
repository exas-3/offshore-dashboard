'use client';

export const fmt = {
  k(n) {
    if (n == null) return '—';
    const a = Math.abs(n);
    if (a >= 1e9) return (n / 1e9).toFixed(2) + 'B';
    if (a >= 1e6) return (n / 1e6).toFixed(a >= 1e7 ? 1 : 2) + 'M';
    if (a >= 1e3) return (n / 1e3).toFixed(a >= 1e4 ? 0 : 1) + 'k';
    return String(Math.round(n));
  },
  n(n) { return n == null ? '—' : n.toLocaleString('en-US'); },
  pct(n, digits = 1) { return n == null ? '—' : n.toFixed(digits) + '%'; },
  signed(n) { if (n == null) return '—'; return (n >= 0 ? '+' : '') + n.toLocaleString('en-US'); },
};

export function blockBar(v, max, width = 28) {
  const filled = Math.max(0, Math.min(1, v / max)) * width;
  const whole = Math.floor(filled);
  const frac = filled - whole;
  const partials = ['', '▏', '▎', '▍', '▌', '▋', '▊', '▉'];
  const pIdx = Math.min(7, Math.round(frac * 8));
  return '█'.repeat(whole) + partials[pIdx] + ' '.repeat(Math.max(0, width - whole - (pIdx ? 1 : 0)));
}
