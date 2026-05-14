'use client';
const OP_LABELS = {
  EXTORTION: 'Extortion',
  ARMS_DEAL: 'Arms Deal',
  DRUG_DEAL: 'Drug Deal',
  PARTIAL: 'Partial',
};

export default function VaultCycle({ cycle, opBreakdown }) {
  const { pct, progress, timeStr, isWeekend, duration } = cycle;

  const r = 72;
  const circ = 2 * Math.PI * r;
  const offset = circ * (1 - progress);

  const totalOps = opBreakdown
    ? Object.values(opBreakdown).reduce((s, v) => s + v, 0)
    : 0;

  return (
    <div className="card vault-card">
      <div className="card-title">
        SWISS VAULT — CURRENT CYCLE
        {isWeekend && <span className="vault-weekend-badge">WEEKEND</span>}
      </div>
      <div className="vault-body">
        <div className="vault-ring-wrap">
          <svg width="180" height="180" className="vault-ring">
            <circle cx="90" cy="90" r={r} fill="none" stroke="#1e1a35" strokeWidth="8" />
            <circle
              cx="90" cy="90" r={r}
              fill="none"
              stroke="#c084fc"
              strokeWidth="8"
              strokeDasharray={circ}
              strokeDashoffset={offset}
              strokeLinecap="round"
              transform="rotate(-90 90 90)"
              suppressHydrationWarning
            />
          </svg>
          <div className="vault-ring-inner">
            <div className="vault-pct">{pct}%</div>
            <div className="vault-pct-label">elapsed</div>
          </div>
        </div>

        <div className="vault-info">
          <div className="vault-row">
            <span className="vault-row-label">ENDS IN</span>
            <span className="vault-countdown">{timeStr}</span>
          </div>
          <div className="vault-row">
            <span className="vault-row-label">DURATION</span>
            <span className="vault-row-value">{isWeekend ? '24 hours' : '8 hours'}</span>
          </div>
          <div className="vault-row">
            <span className="vault-row-label">FREQUENCY</span>
            <span className="vault-row-value">{isWeekend ? '1x daily · weekend' : '3x daily · auto'}</span>
          </div>
          <div className="vault-row">
            <span className="vault-row-label">REWARD TOKEN</span>
            <span className="vault-row-value vault-green">USDm</span>
          </div>
          <div className="vault-row">
            <span className="vault-row-label">POOL FUNDED BY</span>
            <span className="vault-row-value">failed op influence</span>
          </div>

          {opBreakdown && totalOps > 0 && (
            <div className="vault-breakdown">
              <div className="vault-breakdown-title">OPS THIS PERIOD (24H)</div>
              {Object.entries(opBreakdown).map(([k, v]) => (
                <div key={k} className="vault-breakdown-row">
                  <span className={`op-badge op-badge--${k.toLowerCase()}`}>
                    {OP_LABELS[k] ?? k}
                  </span>
                  <div className="op-bar-wrap">
                    <div
                      className="op-bar"
                      style={{ width: totalOps > 0 ? `${(v / totalOps) * 100}%` : '0%' }}
                    />
                  </div>
                  <span className="op-count">{v}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
