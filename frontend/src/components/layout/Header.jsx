import { useAuth } from '../../context/AuthContext';

export default function Header() {
  const { logout } = useAuth();

  return (
    <div
      className="header-bar"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        background: 'var(--color-surface)',
        borderBottom: '1px solid var(--color-border)',
        position: 'sticky',
        top: 0,
        zIndex: 5,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div
          style={{
            width: 32,
            height: 32,
            borderRadius: 9,
            background: 'var(--color-accent)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <div style={{ width: 12, height: 12, border: '2px solid #fff', borderRadius: 3 }} />
        </div>
        <div style={{ fontSize: 18, fontWeight: 700, letterSpacing: '-0.01em' }}>Workout Tracker</div>
      </div>
      <button
        onClick={logout}
        style={{ background: 'none', border: 'none', color: 'var(--color-muted)', fontSize: 14, fontWeight: 600, cursor: 'pointer', padding: 8 }}
      >
        Log out
      </button>
    </div>
  );
}
