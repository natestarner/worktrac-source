import { NavLink } from 'react-router-dom';

const TABS = [
  { path: '/app/log', label: 'Log' },
  { path: '/app/history', label: 'History' },
  { path: '/app/prs', label: 'PRs' },
  { path: '/app/routines', label: 'Routines' },
  { path: '/app/trends', label: 'Trends' },
];

export default function TabsNav() {
  return (
    <div className="tabs-nav-bar" style={{ display: 'flex', gap: 4, overflowX: 'auto' }}>
      <div style={{ display: 'flex', gap: 4, background: 'var(--color-subtle-bg)', borderRadius: 12, padding: 4 }}>
        {TABS.map((tab) => (
          <NavLink
            key={tab.path}
            to={tab.path}
            style={({ isActive }) => ({
              padding: '9px 18px',
              border: 'none',
              borderRadius: 9,
              fontSize: 14,
              fontWeight: 700,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              textDecoration: 'none',
              background: isActive ? 'var(--color-surface)' : 'transparent',
              color: isActive ? 'var(--color-accent)' : 'var(--color-muted)',
              boxShadow: isActive ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
            })}
          >
            {tab.label}
          </NavLink>
        ))}
      </div>
    </div>
  );
}
