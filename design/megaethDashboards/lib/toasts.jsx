// Live trade toast ticker — slides toasts into bottom-right corner of each
// dashboard. Each artboard mounts its own instance (positioned absolutely
// within the artboard so they don't collide).

const { useState: useStateTT, useEffect: useEffectTT } = React;

function LiveToasts({ items, seed = 0, max = 4, interval = 2200 }) {
  const [stack, setStack] = useStateTT([]);
  const [tick, setTick] = useStateTT(0);

  useEffectTT(() => {
    const t = setInterval(() => setTick((x) => x + 1), interval);
    return () => clearInterval(t);
  }, [interval]);

  useEffectTT(() => {
    if (!items.length) return;
    const next = items[(tick + seed) % items.length];
    const id = `${tick}-${Math.random().toString(36).slice(2, 8)}`;
    setStack((s) => {
      const fresh = [{ ...next, id, t: Date.now() }, ...s].slice(0, max);
      return fresh;
    });
    const drop = setTimeout(() => {
      setStack((s) => s.filter((x) => x.id !== id));
    }, interval * (max + 0.5));
    return () => clearTimeout(drop);
  }, [tick, items, seed, interval, max]);

  return (
    <div className="of-toasts">
      {stack.map((t, i) => (
        <div
          key={t.id}
          className={`of-toast of-toast-${t.kind.toLowerCase()}`}
          style={{ '--i': i }}
        >
          <span className="of-toast-mark" data-kind={t.kind}>{t.kind}</span>
          <span className="of-toast-amt">{t.amount} <em>{t.token}</em></span>
          <span className="of-toast-addr">{t.addr}</span>
          <span className="of-toast-x">↗</span>
        </div>
      ))}
    </div>
  );
}
window.LiveToasts = LiveToasts;
