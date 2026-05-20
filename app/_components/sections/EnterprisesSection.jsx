'use client';
import { useEffect, useState, useMemo } from 'react';
import { Region, GridCell, Sortable } from '../terminal.jsx';
import { usePagedRows, Pager } from '../trade-helpers.jsx';

// Maps the on-chain `item_type_id` to the in-game loadout slot label.
// Order matches the in-game enterprise loadout: each slot accepts one item
// per type. 6 slots total, 6 rarities per slot, ~7 templates per slot.
const SLOT_NAMES = {
  1: 'Business',
  2: 'Insurance',
  3: 'Accountant',
  4: 'Method',
  5: 'Associates',
  6: 'OpSec',
};

// Item-type tint — matches the loadout coloring users see in-game.
const SLOT_TINT = {
  Business:   'var(--t-pos)',
  Insurance:  'var(--t-warn)',
  Accountant: 'var(--t-hdr)',
  Method:     'var(--t-neg)',
  Associates: 'var(--t-fg)',
  OpSec:      'var(--t-fg-mut)',
};

export function EnterprisesSection({ grid }) {
  const { spans, heights, resize } = grid;
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sortKey, setSortKey] = useState('slot');
  const [sortDir, setSortDir] = useState('asc');

  useEffect(() => {
    let alive = true;
    fetch('/api/enterprises')
      .then(r => r.json())
      .then(d => { if (alive && d && d.items) { setRows(d.items); setLoading(false); } })
      .catch(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  function sortBy(k) {
    if (sortKey === k) setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    else { setSortKey(k); setSortDir('asc'); }
  }

  const sorted = useMemo(() => {
    const arr = [...rows];
    arr.sort((a, b) => {
      const av = a[sortKey], bv = b[sortKey];
      const x = typeof av === 'number'
        ? av - bv
        : String(av ?? '').localeCompare(String(bv ?? ''));
      return sortDir === 'asc' ? x : -x;
    });
    return arr;
  }, [rows, sortKey, sortDir]);

  const pager = usePagedRows(sorted);

  return (
    <section id="sec-enterprises" className="tm-grid-12">
      <GridCell id="enterprises" span={spans['enterprises'] ?? 12} height={heights['enterprises']} onResize={(r) => resize('enterprises', r)}>
        <Region
          title="enterprises"
          sub="44 item templates · 6 slot types · drop chance scales with legitimacy lvl"
        >
          <div className="tm-scroll-bl" style={{ maxHeight: 420, overflowY: 'auto', overflowX: 'hidden' }}>
            <table className="tm-tab tm-tab-bl" style={{ tableLayout: 'fixed', width: '100%' }}>
              <thead style={{ position: 'sticky', top: 0, background: 'var(--t-bg)', zIndex: 1 }}>
                <tr>
                  <th style={{ width: 28 }}>#</th>
                  <th style={{ width: 100 }}><Sortable label="slot"   k="slot"     sortKey={sortKey} sortDir={sortDir} on={sortBy} /></th>
                  <th><Sortable label="item"                        k="item_name" sortKey={sortKey} sortDir={sortDir} on={sortBy} /></th>
                  <th style={{ width: 140 }}><Sortable label="region" k="region"   sortKey={sortKey} sortDir={sortDir} on={sortBy} /></th>
                  <th style={{ width: 140 }}><Sortable label="city"   k="city"     sortKey={sortKey} sortDir={sortDir} on={sortBy} /></th>
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr><td colSpan={5} className="dim" style={{ padding: '6px 0', fontSize: 'var(--t-fs-xs)' }}>loading…</td></tr>
                )}
                {!loading && rows.length === 0 && (
                  <tr><td colSpan={5} className="dim" style={{ padding: '6px 0', fontSize: 'var(--t-fs-xs)' }}>no items</td></tr>
                )}
                {pager.pageRows.map((r) => (
                  <tr key={r.id}>
                    <td className="dim" style={{ fontSize: 'var(--t-fs-xs)' }}>{r.id}</td>
                    <td style={{ fontSize: 'var(--t-fs-xs)', color: SLOT_TINT[r.slot] || 'var(--t-fg)' }}>{r.slot}</td>
                    <td style={{ fontSize: 'var(--t-fs-xs)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.item_name}</td>
                    <td className="dim" style={{ fontSize: 'var(--t-fs-xs)' }}>{r.region}</td>
                    <td style={{ fontSize: 'var(--t-fs-xs)' }}>{r.city}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager {...pager} />
        </Region>
      </GridCell>
    </section>
  );
}

export { SLOT_NAMES, SLOT_TINT };
