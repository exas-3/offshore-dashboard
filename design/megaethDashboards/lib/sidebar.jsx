// Sidebar: app switcher with future-app stubs.
const { useState: useStateSB } = React;

function Sidebar({ apps, activeAppId, onChange, collapsed }) {
  return (
    <aside className={`of-sidebar ${collapsed ? 'is-collapsed' : ''}`}>
      <div className="of-sidebar-brand">
        <div className="of-sidebar-mark">M*</div>
        {!collapsed && (
          <div className="of-sidebar-brand-text">
            <div className="of-sidebar-brand-name">MEGADASH</div>
            <div className="of-sidebar-brand-sub">megaeth analytics</div>
          </div>
        )}
      </div>

      {!collapsed && (
        <div className="of-sidebar-section-label">Apps</div>
      )}
      <nav className="of-sidebar-nav">
        {apps.filter((a) => !a.isMeta).map((a) => (
          <button
            key={a.id}
            className={`of-sidebar-item ${a.id === activeAppId ? 'is-active' : ''} ${a.active ? '' : 'is-stub'}`}
            onClick={() => a.active && onChange && onChange(a.id)}
            title={a.active ? a.name : `${a.name} — coming soon`}
          >
            <span className="of-sidebar-glyph" data-app={a.id}>{a.glyph}</span>
            {!collapsed && (
              <span className="of-sidebar-item-body">
                <span className="of-sidebar-item-name">{a.name}</span>
                <span className="of-sidebar-item-tag">{a.tag}</span>
              </span>
            )}
            {!collapsed && !a.active && <span className="of-sidebar-soon">SOON</span>}
            {!collapsed && a.id === activeAppId && <span className="of-sidebar-on">●</span>}
          </button>
        ))}
      </nav>

      {!collapsed && (
        <>
          <div className="of-sidebar-section-label">Index</div>
          <nav className="of-sidebar-nav">
            {apps.filter((a) => a.isMeta).map((a) => (
              <button key={a.id} className="of-sidebar-item is-meta is-stub" title={`${a.name} — coming soon`}>
                <span className="of-sidebar-glyph" data-app={a.id}>{a.glyph}</span>
                <span className="of-sidebar-item-body">
                  <span className="of-sidebar-item-name">{a.name}</span>
                  <span className="of-sidebar-item-tag">{a.tag}</span>
                </span>
                <span className="of-sidebar-soon">SOON</span>
              </button>
            ))}
          </nav>
        </>
      )}

      {!collapsed && (
        <div className="of-sidebar-foot">
          <div className="of-sidebar-foot-row"><span>RPC</span><b className="of-ok">live</b></div>
          <div className="of-sidebar-foot-row"><span>BLOCK</span><b>4,128,907</b></div>
          <div className="of-sidebar-foot-row"><span>NET</span><b>megaeth-mainnet</b></div>
        </div>
      )}
    </aside>
  );
}
window.Sidebar = Sidebar;
