import UserMenu from './UserMenu';
import PlanBadge from '../billing/PlanBadge';
import logoLight from '../../assets/huddle-lockup-horizontal-onlight.svg';
import logoDark from '../../assets/huddle-lockup-horizontal-ondark.svg';

// `booting` is forwarded to UserMenu and set only by AppShellSkeleton -- see UserMenu's own
// header comment for why the boot-time copy of this header must not offer an openable menu.
export default function Header({ booting = false }) {
  return (
    <header
      className="header-bar"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        background: 'var(--color-surface)',
        borderBottom: '1px solid var(--color-border)',
      }}
    >
      {/* height 52 is unchanged from the pre-brand-v3 lockup on purpose: these assets carry a
          viewBox cropped to the brand-minimum clear space (docs/brand/README.md), so 52 renders a
          141x52 box against the old 145x52 one. Sizing them from the kit's own uncropped canvas
          instead would silently shrink the mark and grow the header. */}
      <picture>
        <source srcSet={logoDark} media="(prefers-color-scheme: dark)" />
        <img src={logoLight} alt="Huddle" style={{ height: 52, display: 'block' }} />
      </picture>
      {/* The plan control and the account menu share ONE right-aligned group rather than being
          two more children of the space-between row -- a third direct child would spread all
          three across the bar and strand the badge in the middle. PlanBadge renders nothing at
          all while the plan is unknown, so this group collapses to just the menu during boot and
          for any install whose auth snapshot predates billing. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
        <PlanBadge />
        <UserMenu booting={booting} />
      </div>
    </header>
  );
}
