import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';

const TABS = [
  { path: '/admin', label: 'Overview', end: true },
  { path: '/admin/accounts', label: 'Accounts' },
  { path: '/admin/people', label: 'People' },
  { path: '/admin/pending', label: 'Pending' },
];

// Deliberately its own standalone layout, not the workout app's AppShell/Header/TabsNav --
// this is an owner-only observability tool, not another workout tab, and has no notion of
// "active person" to carry.
export default function AdminShell() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  function handleExit() {
    navigate('/app/log');
  }

  function handleLogout() {
    logout();
    navigate('/login');
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--color-bg)' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '16px 24px',
          borderBottom: '1px solid var(--color-border)',
          background: 'var(--color-surface)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{ fontSize: 16, fontWeight: 800 }}>Admin Portal</div>
          <nav style={{ display: 'flex', gap: 4 }}>
            {TABS.map((tab) => (
              <NavLink
                key={tab.path}
                to={tab.path}
                end={tab.end}
                style={({ isActive }) => ({
                  padding: '8px 14px',
                  borderRadius: 9,
                  fontSize: 14,
                  fontWeight: 700,
                  textDecoration: 'none',
                  background: isActive ? 'var(--color-subtle-bg)' : 'transparent',
                  color: isActive ? 'var(--color-accent)' : 'var(--color-muted)',
                })}
              >
                {tab.label}
              </NavLink>
            ))}
          </nav>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 13, color: 'var(--color-muted)' }}>{user?.email}</span>
          <button onClick={handleExit} style={linkButtonStyle}>
            Back to app
          </button>
          <button onClick={handleLogout} style={linkButtonStyle}>
            Logout
          </button>
        </div>
      </div>

      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '24px' }}>
        <Outlet />
      </div>
    </div>
  );
}

const linkButtonStyle = {
  background: 'none',
  border: '1px solid var(--color-border)',
  borderRadius: 8,
  padding: '6px 12px',
  fontSize: 13,
  fontWeight: 600,
  color: 'var(--color-text)',
  cursor: 'pointer',
};
