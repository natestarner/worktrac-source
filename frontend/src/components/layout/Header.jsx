import UserMenu from './UserMenu';
import logoLight from '../../assets/huddle-lockup-horizontal-light.svg';
import logoDark from '../../assets/huddle-lockup-horizontal-dark.svg';

// `booting` is forwarded to UserMenu and set only by AppShellSkeleton -- see UserMenu's own
// header comment for why the boot-time copy of this header must not offer an openable menu.
export default function Header({ booting = false }) {
  return (
    <div
      className="header-bar"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        background: 'var(--color-surface)',
        borderBottom: '1px solid var(--color-border)',
      }}
    >
      <picture>
        <source srcSet={logoDark} media="(prefers-color-scheme: dark)" />
        <img src={logoLight} alt="Huddle" style={{ height: 52, display: 'block' }} />
      </picture>
      <UserMenu booting={booting} />
    </div>
  );
}
