import { NavLink } from 'react-router-dom';
import { TOUR_ANCHORS } from '../onboarding/tourSteps';

const TABS = [
  // tourAnchor is undefined on every tab but Log -- spread as data-tour-anchor={tab.tourAnchor}
  // below, so `undefined` simply renders no attribute at all and no per-tab branch is needed.
  { path: '/app/log', label: 'Log', tourAnchor: TOUR_ANCHORS.LOG_TAB },
  { path: '/app/history', label: 'History' },
  { path: '/app/prs', label: 'PRs' },
  { path: '/app/routines', label: 'Routines' },
  { path: '/app/trends', label: 'Trends' },
];

// Shares the .seg/.seg-item classes with SegmentedToggle. These were two separate
// implementations of the same control (same track, same active pill, same shadow, but
// mismatched radii), and this is the app's primary navigation -- at its old '9px 18px'
// padding it computed to roughly 35px tall, under the 44px touch target on the iPad this
// app is built around. The shared class carries a min-height that fixes that.
export default function TabsNav() {
  return (
    <div className="tabs-nav-bar" style={{ display: 'flex', overflowX: 'auto' }}>
      <nav className="seg" aria-label="Sections">
        {TABS.map((tab) => (
          <NavLink
            key={tab.path}
            to={tab.path}
            data-tour-anchor={tab.tourAnchor}
            className={({ isActive }) => ['seg-item', isActive && 'is-active', 'pressable'].filter(Boolean).join(' ')}
          >
            {tab.label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
