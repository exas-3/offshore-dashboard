// Dashboard composition — all sections, theme-agnostic (reads CSS vars only).
const { useState: useStateD, useMemo: useMemoD } = React;
const D = window.OFFSHORE_DATA;

function Dashboard({ theme, density, accentSet, showToasts = true, fullBleed = false }) {
  const [tab, setTab] = useStateD('Dashboard');
  const [econRange, setEconRange] = useStateD('1D');
  const [econGran, setEconGran] = useStateD('Hourly');
  const [infRange, setInfRange] = useStateD('All');
  const [burnedRange, setBurnedRange] = useStateD('All');
  const [partGran, setPartGran] = useStateD('Daily');
  const [supplyGran, setSupplyGran] = useStateD('Daily');
  const [sortKey, setSortKey] = useStateD('endsIn');
  const [sortDir, setSortDir] = useStateD('asc');
  const [activeApp, setActiveApp] = useStateD('offshore');
  const [walletSearch, setWalletSearch] = useStateD('0x75d6…d40b');

  const sortedTrades = useMemoD(() => {
    const arr = [...D.liveTrades];
    arr.sort((a, b) => {
      const av = a[sortKey], bv = b[sortKey];
      const x = typeof av === 'number' ? av - bv : String(av).localeCompare(String(bv));
      return sortDir === 'asc' ? x : -x;
    });
    return arr;
  }, [sortKey, sortDir]);

  function sortBy(k) {
    if (sortKey === k) setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    else { setSortKey(k); setSortDir('asc'); }
  }

  return (
    <div className={`ofdash theme-${theme} density-${density} accent-${accentSet || 'rainbow'} ${fullBleed ? 'is-fullbleed' : ''}`}>
      {theme === 'phosphor' ? <div className="of-scanlines" aria-hidden="true" /> : null}

      <Sidebar
        apps={D.apps}
        activeAppId={activeApp}
        onChange={setActiveApp}
        collapsed={false}
      />

      <main className="of-main">
        {/* Top bar */}
        <header className="of-topbar">
          <div className="of-topbar-left">
            <div className="of-pagebrand">
              <div className="of-pagebrand-name">OFFSHORE</div>
              <div className="of-pagebrand-sub">DASHBOARD · v0.2</div>
            </div>
            <label className="of-search">
              <span className="of-search-icon">⌕</span>
              <input
                value={walletSearch}
                onChange={(e) => setWalletSearch(e.target.value)}
                placeholder="search address…"
              />
              <span className="of-kbd">⌘K</span>
            </label>
          </div>
          <nav className="of-tabs">
            {['Dashboard', 'Swiss Vault', 'Ongoing Ops', 'Companies', 'Leaderboard'].map((t) => (
              <button key={t} className={t === tab ? 'is-on' : ''} onClick={() => setTab(t)}>{t}</button>
            ))}
          </nav>
          <div className="of-topbar-right">
            <div className="of-strip">
              <span className="of-strip-k">DIRTY</span>
              <span className="of-strip-v" data-c="violet">${D.hero.dirtyPrice.toFixed(4)}</span>
            </div>
            <div className="of-strip">
              <span className="of-strip-k">OP COST</span>
              <span className="of-strip-v" data-c="orange">{D.hero.opCost.toFixed(2)} INF</span>
            </div>
            <div className="of-strip of-strip-pill">
              <span className="of-strip-dot of-strip-dot-live" /> live
            </div>
            <button className="of-iconbtn" title="Notifications">
              <span className="of-bell">🔔</span>
              <span className="of-bell-dot" />
            </button>
            <button className="of-walletpill" title="Connected wallet">
              <span className="of-walletpill-dot" />
              {D.wallet.address}
            </button>
          </div>
        </header>

        {/* ─── Hero row ─────────────────────────────────────────────── */}
        <section className="of-row of-row-hero">
          <HeroStat
            accent="violet"
            label="$DIRTY SUPPLY"
            value={D.hero.supplyTotalCirculating}
            sub="total circulating"
          />
          <HeroStat
            accent="red"
            label="BURNED / SUPPLY"
            value={D.hero.burnedRatio.toFixed(2)}
            sub={`${D.hero.burnedAllTime} burned all time`}
          />
          <HeroStat
            accent="green"
            label="TOTAL OPS"
            value={D.hero.totalOpsLabel}
            sub={`${D.hero.dirtyEmitted} $DIRTY emitted`}
          />
          <HeroStat
            accent="orange"
            label="TOKEN HOLDERS"
            value={D.hero.tokenHolders.toLocaleString()}
            sub={`${D.hero.uniqueWallets.toLocaleString()} unique wallets`}
          />
        </section>

        {/* ─── Token economy ─────────────────────────────────────────── */}
        <section className="of-block">
          <SectionHeading
            right={<>
              <Segmented value={econRange} options={['All','7D','3D','1D']} onChange={setEconRange} />
              <Segmented value={econGran} options={['Daily','Hourly']} onChange={setEconGran} />
            </>}
          >TOKEN ECONOMY</SectionHeading>

          <Card label="$DIRTY SUPPLY OVER TIME — DAILY" right={<Segmented value={supplyGran} options={['Daily','Hourly']} onChange={setSupplyGran} />}>
            <LineArea data={D.supplyOverTime} color="violet" height={200} valueFormat={(v)=> (v/1e6).toFixed(2)+'M'} tooltipLabel="Supply" />
          </Card>

          <Card
            label="EMISSIONS VS BURN — HOURLY"
            right={<Segmented value={econRange} options={['All','7D','3D','1D']} onChange={setEconRange} />}
          >
            <ComboBarLine
              data={D.emissionsVsBurn}
              bars={[
                { key: 'minted',       label: 'Minted',        color: 'violet' },
                { key: 'spent',        label: 'Spent',         color: 'red' },
                { key: 'protocolMint', label: 'Protocol Mint', color: 'magenta' },
              ]}
              line={{ key: 'net', label: 'Net (players)', color: 'cyan' }}
              height={300}
            />
            <Legend items={[
              { label: 'Minted', color: 'violet' },
              { label: 'Spent', color: 'red' },
              { label: 'Protocol Mint', color: 'magenta' },
              { label: 'Net (players)', color: 'cyan', shape: 'line' },
            ]} />
          </Card>

          <Card label="$DIRTY BURNED — DAILY" right={<Segmented value={burnedRange} options={['All','7D','3D','1D']} onChange={setBurnedRange} />}>
            <StackedBar
              data={D.burnedDaily}
              series={[
                { key: 'protocolBurn', label: 'Protocol Burn',  color: 'red' },
                { key: 'asset',        label: 'Asset Purchase', color: 'violet' },
                { key: 'levelUp',      label: 'Level Up',       color: 'cyan' },
                { key: 'thirdEnt',     label: 'Third Enterprise',color:'magenta' },
              ]}
              height={240}
            />
            <Legend items={[
              { label: 'Protocol Burn', color: 'red' },
              { label: 'Asset Purchase', color: 'violet' },
              { label: 'Level Up', color: 'cyan' },
              { label: 'Third Enterprise', color: 'magenta' },
            ]} />
          </Card>

          <Card label="INFLUENCE FLOW — ALL TIME (DAILY)" right={<Segmented value={infRange} options={['24h','72h','All']} onChange={setInfRange} />}>
            <div className="of-inf-totals">
              <div><div className="of-inf-k">PURCHASED</div><div className="of-inf-v" data-c="cyan">{FormatNum.full(D.influenceFlow.totals.purchased)}</div></div>
              <div><div className="of-inf-k">CONSUMED</div><div className="of-inf-v" data-c="red">{FormatNum.full(D.influenceFlow.totals.consumed)}</div></div>
              <div><div className="of-inf-k">REFUNDED</div><div className="of-inf-v" data-c="green">{FormatNum.full(D.influenceFlow.totals.refunded)}</div></div>
              <div><div className="of-inf-k">CIRCULATING</div><div className="of-inf-v">{FormatNum.full(D.influenceFlow.totals.circulating)}</div></div>
            </div>
            <GroupedBars
              data={D.influenceFlow.days}
              series={[
                { key: 'purchased', label: 'Purchased', color: 'cyan' },
                { key: 'consumed',  label: 'Consumed',  color: 'red' },
                { key: 'refunded',  label: 'Refunded',  color: 'green' },
              ]}
              height={220}
            />
            <Legend items={[
              { label: 'Purchased', color: 'cyan' },
              { label: 'Consumed', color: 'red' },
              { label: 'Refunded', color: 'green' },
            ]} />
          </Card>
        </section>

        {/* ─── Player activity ───────────────────────────────────────── */}
        <section className="of-block">
          <SectionHeading
            right={<Segmented value={partGran} options={['Daily','Hourly']} onChange={setPartGran} />}
          >PLAYER ACTIVITY</SectionHeading>

          <div className="of-grid of-grid-2">
            <Card label="NEW PARTICIPANTS — DAILY FROM LAUNCH" right={<span className="of-card-pill">{D.newParticipantsTotal.toLocaleString()} total</span>}>
              <BarChart data={D.newParticipants} color="cyan" height={200} tooltipLabel="New" />
            </Card>
            <Card label="DAILY ACTIVE WALLETS — DAILY FROM LAUNCH" right={<span className="of-card-pill">peak {D.dailyActiveWalletsPeak.toLocaleString()}</span>}>
              <BarChart data={D.dailyActiveWallets} color="violet" height={200} tooltipLabel="Wallets" />
            </Card>
          </div>

          <Card label="ACTIVITY HEATMAP — OPS PER HOUR · LAST 7 DAYS">
            <Heatmap grid={D.heatmap} days={D.heatmapDays} color="green" />
          </Card>
        </section>

        {/* ─── Distribution / payouts ────────────────────────────────── */}
        <section className="of-block">
          <SectionHeading>SWISS VAULT DISTRIBUTION</SectionHeading>

          <div className="of-row of-row-3">
            <HeroStat accent="violet" label="TOTAL DISTRIBUTED" value={D.distributionTotals.totalLabel} sub="USDm to players" />
            <HeroStat accent="green"  label="CYCLES PAID"      value={D.distributionTotals.cyclesPaid} sub="cycles with payouts" />
            <HeroStat accent="orange" label="UNIQUE RECIPIENTS"value={D.distributionTotals.uniqueRecipients.toLocaleString()} sub="wallets ever paid" />
          </div>

          <Card label="USDm DISTRIBUTED PER CYCLE">
            <BarChart data={D.usdmPerCycle.map(d => ({ x: d.t, v: d.v }))} color="violet" height={200} valueFormat={(v) => (v/1000) + 'k'} tooltipLabel="USDm" />
          </Card>

          <div className="of-grid of-grid-2">
            <Card label="RECIPIENTS PER CYCLE">
              <BarChart data={D.recipientsPerCycle.map(d => ({ x: d.t, v: d.v }))} color="cyan" height={180} tooltipLabel="Recipients" />
            </Card>
            <Card label="NEW RECIPIENTS PER CYCLE">
              <BarChart data={D.newRecipientsPerCycle.map(d => ({ x: d.t, v: d.v }))} color="green" height={180} tooltipLabel="New" />
            </Card>
          </div>
        </section>

        {/* ─── Companies / on-chain trades ───────────────────────────── */}
        <section className="of-block">
          <SectionHeading right={<button className="of-bellbtn">🔔 ALL ON</button>}>COMPANIES & ON-CHAIN TRADES</SectionHeading>

          <div className="of-row of-row-3">
            <HeroStat accent="violet" label="TOTAL COMPANIES" value={D.companies.totalCompanies.toLocaleString()} sub={`${D.companies.uniqueOwners.toLocaleString()} unique owners`} />
            <HeroStat accent="green"  label="ACTIVE TRADES" value={D.companies.activeTrades} sub="currently running" />
            <HeroStat accent="orange" label="AUTO-TRADE ON" value={D.companies.autoTradeOn} sub={D.companies.autoTradeShareLabel} />
          </div>

          <Card label="LIVE ON-CHAIN">
            <div className="of-onchain-strip">
              <div><div className="of-oc-k">INFLUENCE</div><div className="of-oc-v" data-c="violet">{D.onChainStrip.influence}</div><div className="of-oc-sub">$INFLUENCE held</div></div>
              <div><div className="of-oc-k">DIRTY BAL</div><div className="of-oc-v" data-c="green">{D.onChainStrip.dirtyBal}</div><div className="of-oc-sub">$DIRTY held</div></div>
              <div><div className="of-oc-k">OP COST</div><div className="of-oc-v" data-c="orange">{D.onChainStrip.opCost}</div><div className="of-oc-sub">last trade</div></div>
              <div><div className="of-oc-k">COMPANIES</div><div className="of-oc-v">{D.onChainStrip.companies}</div><div className="of-oc-sub">{D.onChainStrip.activeCompanies} active · {D.onChainStrip.autoCompanies} auto-on</div></div>
              <div><div className="of-oc-k">STATUS</div><div className="of-oc-v" data-c="green">{D.onChainStrip.status}</div><div className="of-oc-sub">nominal</div></div>
            </div>

            <div className="of-table-wrap">
              <table className="of-table of-trades">
                <thead>
                  <tr>
                    <th><Sortable label="COMPANY" k="id"      sortKey={sortKey} sortDir={sortDir} on={sortBy} /></th>
                    <th><Sortable label="AUTO"    k="auto"    sortKey={sortKey} sortDir={sortDir} on={sortBy} /></th>
                    <th><Sortable label="ACTIVE"  k="active"  sortKey={sortKey} sortDir={sortDir} on={sortBy} /></th>
                    <th><Sortable label="ENDS IN" k="endsIn"  sortKey={sortKey} sortDir={sortDir} on={sortBy} /></th>
                    <th style={{ textAlign: 'right' }}><Sortable label="LIQ PRICE" k="liqPrice" sortKey={sortKey} sortDir={sortDir} on={sortBy} /></th>
                    <th style={{ textAlign: 'right' }}>ETH PRICE / BUFFER</th>
                    <th style={{ textAlign: 'right' }}><Sortable label="ENTRY"     k="entry"    sortKey={sortKey} sortDir={sortDir} on={sortBy} /></th>
                    <th style={{ width: 38 }}>🔔</th>
                    <th style={{ width: 30 }}>⋯</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedTrades.map((r) => (
                    <tr key={r.id}>
                      <td><span className="of-mono">{r.id}</span></td>
                      <td className={r.auto ? 'of-cell-on' : 'of-cell-off'}>{r.auto ? 'ON' : 'OFF'}</td>
                      <td>
                        <span className={`of-pill ${r.active ? 'of-pill-yes' : 'of-pill-no'}`}>{r.active ? 'YES' : 'NO'}</span>
                      </td>
                      <td className={r.active ? 'of-cell-time' : 'of-cell-muted'}>{r.endsIn}</td>
                      <td style={{ textAlign: 'right' }}>{r.liqPrice.toLocaleString()}</td>
                      <td style={{ textAlign: 'right' }}>
                        <div className="of-cell-eth">
                          <div className="of-cell-eth-px" data-c="violet">${r.ethPrice.toFixed(2)}</div>
                          <div className={`of-cell-eth-buf ${r.buffer >= 0 ? 'of-pos' : 'of-neg'}`}>${r.buffer >= 0 ? r.buffer.toFixed(2) : r.buffer.toFixed(2)}</div>
                        </div>
                      </td>
                      <td style={{ textAlign: 'right' }}>${r.entry.toFixed(2)}</td>
                      <td><span className="of-bell-cell">🔔</span></td>
                      <td><span className="of-more">[…]</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </section>

        {/* ─── Personal wallet ────────────────────────────────────────── */}
        <section className="of-block">
          <SectionHeading right={<span className="of-card-pill of-card-pill-active">{walletSearch}</span>}>YOUR WALLET</SectionHeading>

          <Card label="INDEXED STATS">
            <div className="of-stat-grid">
              <StatCard label="TOTAL OPS"    value={D.wallet.indexed.totalOps} />
              <StatCard accent="violet" label="DIRTY EARNED" value={D.wallet.indexed.dirtyEarned} />
              <StatCard accent="red"    label="DIRTY SPENT"  value={D.wallet.indexed.dirtySpent} />
              <StatCard accent="orange" label="INF BOUGHT"   value={D.wallet.indexed.infBought.toLocaleString()} sub={`${D.wallet.indexed.infBoughtPurchases} purchases`} />
              <StatCard accent="green"  label="INF REFUNDED" value={D.wallet.indexed.infRefunded.toLocaleString()} />
              <StatCard accent="red"    label="DEX SOLD"     value={D.wallet.indexed.dexSold} sub={`${D.wallet.indexed.dexSoldTxs} txs`} />
              <StatCard accent="violet" label="DEX BOUGHT"   value={D.wallet.indexed.dexBought} sub={`${D.wallet.indexed.dexBoughtTxs} txs`} />
              <StatCard accent="cyan"   label="VAULT CLAIMED"value={D.wallet.indexed.vaultClaimed} sub={`${D.wallet.indexed.vaultPayouts} payouts`} />
              <StatCard accent="green"  label="BALANCE"      value={D.wallet.indexed.balance} />
            </div>
          </Card>

          <div className="of-grid of-grid-2">
            <Card label="DIRTY EARNED BY OPERATION">
              <ShareTable
                headers={[
                  { label: 'TYPE' },
                  { label: 'OPS',   align: 'right' },
                  { label: 'DIRTY', align: 'right' },
                  { label: 'SHARE', align: 'right' },
                ]}
                rows={D.wallet.earnedByOp}
              />
            </Card>
            <Card label="HOW DIRTY WAS SPENT">
              <ShareTable
                headers={[
                  { label: 'TYPE' },
                  { label: 'COUNT', align: 'right' },
                  { label: 'DIRTY', align: 'right' },
                  { label: 'SHARE', align: 'right' },
                ]}
                rows={D.wallet.spent}
              />
            </Card>
          </div>

          <Card label="$DIRTY FARMED OVER TIME (DAILY)">
            <GroupedBars
              data={D.wallet.farmedDaily}
              series={[
                { key: 'earned', label: 'Earned', color: 'green' },
                { key: 'spent',  label: 'Spent',  color: 'red' },
              ]}
              height={240}
            />
            <Legend items={[
              { label: 'Earned', color: 'green' },
              { label: 'Spent', color: 'red' },
            ]} />
          </Card>

          <div className="of-grid of-grid-2">
            <Card label="SHARE OF OPS">
              <Treemap items={D.wallet.earnedByOp.map((r) => ({ label: r.type, value: r.share, color: r.color }))} height={140} />
            </Card>
            <Card label="SHARE OF SPEND">
              <Treemap items={D.wallet.spent.map((r) => ({ label: r.type, value: r.share == null ? 0.5 : r.share, color: r.color }))} height={140} />
            </Card>
          </div>
        </section>

        <footer className="of-foot">
          <span>MEGADASH · OFFSHORE · indexed @ block <b>4,128,907</b></span>
          <span className="of-foot-r">data · megaeth mainnet rpc · refresh 12s</span>
        </footer>
      </main>

      {showToasts && <LiveToasts items={D.liveTradeTicker} seed={theme === 'neon' ? 0 : theme === 'mono' ? 2 : 5} />}
    </div>
  );
}

function Sortable({ label, k, sortKey, sortDir, on }) {
  return (
    <button className={`of-sort ${sortKey === k ? 'is-on' : ''}`} onClick={() => on(k)}>
      {label}
      <span className="of-sort-caret">{sortKey === k ? (sortDir === 'asc' ? '▴' : '▾') : '↕'}</span>
    </button>
  );
}

window.Dashboard = Dashboard;
