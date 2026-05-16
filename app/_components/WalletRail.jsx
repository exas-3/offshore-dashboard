'use client';
import { useState, useRef, useEffect } from 'react';
import { Region, KV, KVSep, BarRow2, fmt } from './terminal.jsx';
import { fmtCountdownLocal } from './trade-helpers.jsx';

function midTrunc(s, front = 10, back = 8) {
  if (!s || s.length <= front + back + 3) return s;
  return s.slice(0, front) + '…' + s.slice(-back);
}

function EditableAddress({ address, onChange }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(address || '');
  useEffect(() => { setVal(address || ''); }, [address]);

  function commit() {
    setEditing(false);
    onChange(val.trim());
  }

  if (editing) return (
    <input
      className="tm-addr-input"
      value={val}
      onChange={e => { setVal(e.target.value); onChange(e.target.value.trim()); }}
      onBlur={commit}
      onKeyDown={e => {
        if (e.key === 'Enter') commit();
        if (e.key === 'Escape') { setEditing(false); setVal(address || ''); onChange(''); }
      }}
      autoFocus
      spellCheck={false}
      style={{ width: '100%', background: 'transparent', border: 'none', outline: 'none', color: 'var(--t-hdr)', fontFamily: 'inherit', fontSize: 'inherit' }}
    />
  );

  return (
    <span
      className="tm-hot"
      style={{ cursor: 'text', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
      title={address || 'click to enter address'}
      onClick={() => setEditing(true)}
    >
      {address ? midTrunc(address) : <span className="dim">click to enter address</span>}
    </span>
  );
}

export function WalletRail({ address, onAddressChange, ethPrice = 0, newOps = [] }) {
  const [dbData,   setDbData]   = useState(null);
  const [liveData, setLiveData] = useState(null);
  const [loading,  setLoading]  = useState(false);
  const [tick,     setTick]     = useState(0);
  const [alarmOn,    setAlarmOn]    = useState(false);
  const alarmOnRef   = useRef(false);
  const compAddrsRef = useRef([]);
  alarmOnRef.current = alarmOn;

  useEffect(() => {
    const t = setInterval(() => setTick(n => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  function playAlarm(which) {
    try { new Audio(`/sounds/${which}.mp3`).play(); } catch {}
  }

  useEffect(() => {
    if (!alarmOnRef.current || !address || !newOps.length) return;
    const addr = address.toLowerCase();
    const mine = newOps.filter(o => (o.walletFull || '').toLowerCase() === addr);
    if (!mine.length) return;
    const hasSuccess = mine.some(o => o.result === 'completed');
    if (hasSuccess) {
      playAlarm('success');
      if (typeof document !== 'undefined' && document.hidden &&
          typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        new Notification('Op completed', { body: address.slice(0, 10) + '…', silent: true });
      }
    } else {
      playAlarm('partial');
      if (typeof document !== 'undefined' && document.hidden &&
          typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        new Notification('Op partial / bust', { body: address.slice(0, 10) + '…', silent: true });
      }
    }
  }, [newOps]);

  useEffect(() => {
    if (!address || !/^0x[0-9a-fA-F]{40}$/.test(address)) {
      setDbData(null); setLiveData(null);
      compAddrsRef.current = [];
      return;
    }
    setLoading(true);
    const addr = address.toLowerCase();
    Promise.all([
      fetch(`/api/players/${addr}`).then(r => r.json()).catch(() => null),
      fetch(`/api/monitor?wallet=${addr}`).then(r => r.json()).catch(() => null),
    ]).then(([db, live]) => {
      setDbData(db?.error ? null : db);
      if (live && !live.error) {
        compAddrsRef.current = (live.companies ?? []).map(c => c.company);
        setLiveData(live);
      }
      setLoading(false);
    });
  }, [address]);

  useEffect(() => {
    if (!address || !/^0x[0-9a-fA-F]{40}$/.test(address)) return;
    const poll = () => {
      const addrs = compAddrsRef.current;
      if (!addrs.length) return;
      fetch(`/api/monitor/states?addrs=${addrs.join(',')}`)
        .then(r => r.json())
        .then(d => {
          if (!d?.error && d.companies) {
            setLiveData(prev => prev ? { ...prev, companies: d.companies } : prev);
          }
        })
        .catch(() => {});
    };
    const t = setInterval(poll, 1_000);
    return () => clearInterval(t);
  }, [address]);

  useEffect(() => {
    if (alarmOn && typeof Notification !== 'undefined' && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }, [alarmOn]);

  const addrRow = (
    <div className="tm-rail-addr" style={{ display: 'flex', alignItems: 'center', gap: 4, overflow: 'hidden' }}>
      <EditableAddress address={address} onChange={onAddressChange} />
      {address && <span className="x" title="clear" style={{ flexShrink: 0, cursor: 'pointer' }} onClick={() => onAddressChange('')}>×</span>}
    </div>
  );

  const isFullAddr = /^0x[0-9a-fA-F]{40}$/.test(address);

  if (!address) return (
    <>
      <div className="tm-rail-h">criminal</div>
      {addrRow}
    </>
  );

  return (
    <>
      <div className="tm-rail-h">criminal <em>· {loading ? 'loading…' : isFullAddr ? 'inspected' : 'enter full address'}</em></div>
      {addrRow}
      {isFullAddr && (
        <div
          onClick={() => setAlarmOn(v => !v)}
          style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6,
            fontSize: 'var(--t-fs-xs)', userSelect: 'none', padding: '3px 0',
            color: alarmOn ? 'var(--t-warn)' : 'var(--t-fg-soft)' }}
        >
          <span style={{ fontSize: 10 }}>{alarmOn ? '◉' : '○'}</span>
          <span>{alarmOn ? 'alarm on' : 'alarm off'}</span>
        </div>
      )}

      {!isFullAddr && (
        <div className="dim" style={{ fontSize: 'var(--t-fs-xs)', padding: '4px 0' }}>enter a full 0x… address</div>
      )}

      {isFullAddr && dbData?.stats && (
        <Region title="indexed stats">
          <KV k="total ops"    v={fmt.n(dbData.stats.ops)} />
          <KV k="dirty earned" v={fmt.k(dbData.stats.earned)}  cls="pos" />
          <KV k="dirty spent"  v={fmt.k(dbData.stats.spent)}   cls="neg" />
          <KV k="balance"      v={fmt.k(dbData.stats.balance)} />
          <KVSep />
          <KV k="inf bought"   v={fmt.n(dbData.influence?.totalPurchased ?? 0)} sub={`${dbData.influence?.purchaseCount ?? 0} purchases`} />
          <KV k="inf refunded" v={fmt.n(dbData.influence?.totalRefunded  ?? 0)} />
          <KV k="dex bought"   v={fmt.k(dbData.stats.dex_bought)} sub={`${dbData.breakdown?.dex_bought?.cnt ?? 0} txs`} />
          <KV k="dex sold"     v={fmt.k(dbData.stats.dex_sold)}   sub={`${dbData.breakdown?.dex_sold?.cnt   ?? 0} txs`} cls="neg" />
          <KVSep />
          <KV k="vault claimed" v={`$${fmt.k(dbData.stats.vault_claimed)}`} cls="hdr" sub={`${dbData.stats.vault_count} payouts`} />
        </Region>
      )}

      {isFullAddr && liveData?.companies?.length > 0 && (
        <Region title="live companies">
          {liveData.companies.filter(c => c.endTime > 0).map(c => {
            const liveEth = ethPrice || liveData.currentEthPrice || 0;
            const buf = liveEth && c.liqPrice
              ? Math.round((liveEth - (Number(BigInt(c.liqPrice) / 10n ** 12n) / 1e6)) * 100) / 100
              : null;
            return (
              <div key={c.company} className="tm-kv" style={{ marginBottom: 2 }}>
                <span className="k" style={{ fontFamily: 'var(--t-font)', fontSize: 'var(--t-fs-xs)' }}>
                  {c.company.slice(0, 6)}…{c.company.slice(-4)}
                  {c.autoTradeEnabled && <span className="dim"> auto</span>}
                </span>
                <span className={`v ${buf == null ? '' : buf >= 0 ? 'pos' : 'neg'}`} style={{ fontSize: 'var(--t-fs-xs)' }}>
                  {buf == null ? '—' : `${buf >= 0 ? '+' : ''}${buf.toFixed(2)}`}
                  {c.active && c.endTime > 0 && <span className="dim"> {fmtCountdownLocal(c.endTime)}</span>}
                </span>
              </div>
            );
          })}
          {liveData.influenceBalance != null && (
            <>
              <KVSep />
              <KV k="inf bal"   v={fmt.k(liveData.influenceBalance)} />
              <KV k="dirty bal" v={fmt.k(liveData.dirtyBalance)} />
            </>
          )}
        </Region>
      )}

      {isFullAddr && dbData?.history?.length > 1 && (
        <Region title="farmed daily">
          <BarRow2
            data={dbData.history.map(h => ({ x: h.day?.slice(5) ?? h.day, earned: Number(h.earned), spent: Number(h.spent) }))}
            series={[
              { key: 'spent',  label: 'spent',  color: 'neg', dir: 'rtl' },
              { key: 'earned', label: 'earned', color: 'pos' },
            ]}
            hideNum
          />
        </Region>
      )}

      {isFullAddr && !loading && !dbData && !liveData && (
        <div className="dim" style={{ fontSize: 'var(--t-fs-xs)', padding: '4px 0' }}>no data found for this address</div>
      )}
    </>
  );
}
