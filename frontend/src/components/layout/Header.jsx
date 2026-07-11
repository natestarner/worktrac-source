import { useAuth } from '../../context/AuthContext';
import logoLight from '../../assets/huddle-lockup-horizontal-light.svg';
import logoDark from '../../assets/huddle-lockup-horizontal-dark.svg';

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
      <picture>
        <source srcSet={logoDark} media="(prefers-color-scheme: dark)" />
        <img src={logoLight} alt="Huddle" style={{ height: 52, display: 'block' }} />
      </picture>
      <button
        onClick={logout}
        style={{ background: 'none', border: 'none', color: 'var(--color-muted)', fontSize: 14, fontWeight: 600, cursor: 'pointer', padding: 8 }}
      >
        Log out
      </button>
    </div>
  );
}
