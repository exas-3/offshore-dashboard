'use client';

export function OverviewSection({ D, counters, infPurchased, dawPct }) {
  return (
    <section id="sec-overview" className="tm-grid-12">
      <div className="c-12">
        <div className="tm-stateline">
          <span className="prompt">&gt;</span>
          <span><span className="k">state ·</span> burn outpacing emission <b className="warn">{D.hero.burnedRatio}×</b></span>
          <span className="sep">·</span>
          <span><span className="k">total burned</span> <b className="neg">{D.hero.burnedAllTime} $dirty</b></span>
          <span className="sep">·</span>
          <span><span className="k">total inf bought</span> <b className="pos">{infPurchased.toLocaleString()}</b></span>
          <span className="sep">·</span>
          <span><span className="k">daily active criminals</span> <b>{counters.daw.toLocaleString()}</b> <span className="k">{dawPct > 0 ? `(▾ ${dawPct}% from peak)` : '(at peak)'}</span></span>
          <span className="sep">·</span>
          <span><span className="k">world time</span> <b>{D.currentWorldTime || 'Q4 2012'}</b></span>
        </div>
      </div>
    </section>
  );
}
