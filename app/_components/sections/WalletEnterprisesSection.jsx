'use client';
import { useEffect, useState } from 'react';
import { Region, GridCell } from '../terminal.jsx';

const SLOT_TINT = {
  Business:   'var(--t-pos)',
  Insurance:  'var(--t-warn)',
  Accountant: 'var(--t-hdr)',
  Method:     'var(--t-neg)',
  Associates: 'var(--t-fg)',
  OpSec:      'var(--t-fg-mut)',
};

const RARITY_COLOR = {
  common:    'var(--t-fg-mut)',
  rare:      'var(--t-hdr)',
  epic:      'var(--t-warn)',
  legendary: 'var(--t-neg)',
};

const RARITY_SYMBOL = {
  common: '○', rare: '◇', epic: '◆', legendary: '★',
};

// Per-wallet enterprises panel — shows each of the wallet's loadouts
// (generators) with the items equipped in each of the 6 slots, plus the
// items they own but haven't equipped yet.
export function WalletEnterprisesSection({ address, grid }) {
  const { spans, heights, resize } = grid;
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  // Unequipped list is collapsed by default — most users care about
  // equipped loadouts; the bench can be opened on demand.
  const [unequippedOpen, setUnequippedOpen] = useState(false);

  useEffect(() => {
    if (!/^0x[0-9a-fA-F]{40}$/.test(address)) return;
    let alive = true;
    setLoading(true);
    fetch(`/api/wallet-enterprises/${address.toLowerCase()}`)
      .then(r => r.json())
      .then(d => { if (alive && !d.error) { setData(d); setLoading(false); } })
      .catch(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [address]);

  const generators = data?.generators || [];
  const inventory  = data?.inventory  || [];
  const equippedIds = new Set(
    generators.flatMap(g => g.slots.map(s => s.item?.itemId).filter(Boolean))
  );
  const unequipped = inventory.filter(it => !equippedIds.has(it.itemId));

  return (
    <GridCell id="enterprises-user" span={spans['enterprises-user'] ?? 12} height={heights['enterprises-user']} onResize={(r) => resize('enterprises-user', r)}>
      <Region
        title="enterprises"
        sub={`${data?.generatorCount ?? 0} loadouts · ${data?.inventoryCount ?? 0} unequipped`}
      >
        {loading && (
          <div className="dim" style={{ fontSize: 'var(--t-fs-xs)', padding: '4px 0' }}>loading…</div>
        )}
        {!loading && generators.length === 0 && (
          <div className="dim" style={{ fontSize: 'var(--t-fs-xs)', padding: '4px 0' }}>no loadouts</div>
        )}

        {generators.map((g, gi) => (
          <div key={g.generatorId} style={{ marginBottom: 10 }}>
            <div style={{
              fontSize: 'var(--t-fs-xs)',
              color: 'var(--t-fg-soft)',
              letterSpacing: '0.06em',
              margin: '2px 0 3px',
              borderBottom: '1px dotted var(--t-rule)',
              paddingBottom: 2,
            }}>
              ENTERPRISE {gi + 1} <span className="dim">· gen #{g.generatorId}</span>
            </div>
            {g.slots.map((s) => {
              const it = s.item;
              const rcolor = it ? (RARITY_COLOR[it.rarityName] || 'var(--t-fg-mut)') : 'var(--t-fg-dim)';
              const rsym   = it ? (RARITY_SYMBOL[it.rarityName] || '·') : '·';
              return (
                <div key={s.slotIdx} className="tm-kv" style={{ marginBottom: 1 }}>
                  <span className="k" style={{ fontFamily: 'var(--t-font)', fontSize: 'var(--t-fs-xs)' }}>
                    <span style={{ color: SLOT_TINT[s.slot] || 'var(--t-fg)', marginRight: 5, display: 'inline-block', minWidth: 64 }}>
                      {s.slot}
                    </span>
                    {it
                      ? <span title={`${it.city}, ${it.region} · ${it.rarityName}`}>
                          <span style={{ color: rcolor, marginRight: 3 }}>{rsym}</span>
                          {it.name}
                        </span>
                      : <span className="dim">— empty —</span>
                    }
                  </span>
                  <span className="v dim" style={{ fontSize: 'var(--t-fs-xs)' }}>
                    {it ? it.city : ''}
                  </span>
                </div>
              );
            })}
          </div>
        ))}

        {unequipped.length > 0 && (
          <div style={{ marginTop: 8 }}>
            <div
              role="button"
              tabIndex={0}
              onClick={() => setUnequippedOpen(o => !o)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setUnequippedOpen(o => !o); } }}
              style={{
                fontSize: 'var(--t-fs-xs)',
                color: 'var(--t-fg-soft)',
                letterSpacing: '0.06em',
                margin: '2px 0 3px',
                borderBottom: '1px dotted var(--t-rule)',
                paddingBottom: 2,
                cursor: 'pointer',
                userSelect: 'none',
                display: 'flex',
                alignItems: 'baseline',
                justifyContent: 'space-between',
              }}
            >
              <span>UNEQUIPPED ({unequipped.length})</span>
              <span className="dim" style={{ fontSize: 9 }}>{unequippedOpen ? '▾ collapse' : '▸ expand'}</span>
            </div>
            {unequippedOpen && unequipped.map((it) => (
              <div key={it.itemId} className="tm-kv" style={{ marginBottom: 1 }}>
                <span className="k" style={{ fontFamily: 'var(--t-font)', fontSize: 'var(--t-fs-xs)' }}>
                  <span style={{ color: SLOT_TINT[it.slot] || 'var(--t-fg)', marginRight: 5, display: 'inline-block', minWidth: 64 }}>
                    {it.slot || '?'}
                  </span>
                  <span style={{ color: RARITY_COLOR[it.rarityName] || 'var(--t-fg-mut)', marginRight: 3 }}>
                    {RARITY_SYMBOL[it.rarityName] || '·'}
                  </span>
                  {it.name}
                </span>
                <span className="v dim" style={{ fontSize: 'var(--t-fs-xs)' }}>{it.city}</span>
              </div>
            ))}
          </div>
        )}
      </Region>
    </GridCell>
  );
}
