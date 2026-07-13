import UserMenu from './UserMenu';
import logoLight from '../../assets/huddle-lockup-horizontal-light.svg';
import logoDark from '../../assets/huddle-lockup-horizontal-dark.svg';

export default function Header() {
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
      <UserMenu />
    </div>
  );
}
