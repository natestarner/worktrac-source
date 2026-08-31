/* Icon set.
 *
 * Path data from Lucide (https://lucide.dev), ISC License, Copyright (c) for
 * portions of Lucide are held by Cole Bemis 2013-2022 as part of Feather (MIT).
 *
 * Vendored rather than depended on. We need ~14 of Lucide's 1500+ icons, the
 * frontend deliberately keeps its runtime dependency list short, and importing
 * lucide-react's barrel makes Vite pre-bundle ~1500 modules on a cold dev start.
 * Copying the paths keeps Lucide's geometry -- uniform 24x24 box, 2px stroke,
 * round caps and joins -- without any of that.
 *
 * These replace the emoji + text-glyph mix the app used before. Emoji render as
 * full-colour platform-specific art: they ignore the theme, ignore the accent
 * colour, and look different on every OS. Everything here is stroke-only and
 * inherits `currentColor`, so an icon takes the colour of whatever it sits in
 * and works in both themes for free.
 *
 * Every icon is aria-hidden. They are decoration -- the accessible name always
 * belongs to the button wrapping the icon, never to the icon itself. Several
 * e2e specs select set-row controls by their accessible name ("Edit", "Delete"),
 * so a button that loses its visible text MUST gain the equivalent aria-label.
 */

function Icon({ size = 16, children, ...rest }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      style={{ display: 'block', flexShrink: 0 }}
      {...rest}
    >
      {children}
    </svg>
  );
}

// Favourite toggle. Two icons rather than one filled/unfilled prop so the
// "on" state reads at a glance instead of relying on fill alone.
export const IconStar = (props) => (
  <Icon {...props}>
    <path d="M11.5 2.9a.6.6 0 0 1 1 0l2.6 5.2 5.8.9a.6.6 0 0 1 .3 1l-4.2 4 1 5.7a.6.6 0 0 1-.9.7L12 17.8l-5.1 2.6a.6.6 0 0 1-.9-.7l1-5.7-4.2-4a.6.6 0 0 1 .3-1l5.8-.9Z" />
  </Icon>
);

export const IconStarFilled = (props) => (
  <Icon fill="currentColor" {...props}>
    <path d="M11.5 2.9a.6.6 0 0 1 1 0l2.6 5.2 5.8.9a.6.6 0 0 1 .3 1l-4.2 4 1 5.7a.6.6 0 0 1-.9.7L12 17.8l-5.1 2.6a.6.6 0 0 1-.9-.7l1-5.7-4.2-4a.6.6 0 0 1 .3-1l5.8-.9Z" />
  </Icon>
);

// A standing note that persists across every session for an exercise.
export const IconPin = (props) => (
  <Icon {...props}>
    <path d="M12 17v5" />
    <path d="M9 10.8V4h6v6.8l2 2.7V17H7v-3.5Z" />
  </Icon>
);

// A note scoped to today's session.
export const IconNote = (props) => (
  <Icon {...props}>
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
  </Icon>
);

export const IconMore = (props) => (
  <Icon {...props}>
    <circle cx="12" cy="12" r="1" />
    <circle cx="12" cy="5" r="1" />
    <circle cx="12" cy="19" r="1" />
  </Icon>
);

export const IconChevronDown = (props) => (
  <Icon {...props}>
    <path d="m6 9 6 6 6-6" />
  </Icon>
);

export const IconClose = (props) => (
  <Icon {...props}>
    <path d="M18 6 6 18" />
    <path d="m6 6 12 12" />
  </Icon>
);

export const IconPlus = (props) => (
  <Icon {...props}>
    <path d="M5 12h14" />
    <path d="M12 5v14" />
  </Icon>
);

export const IconMinus = (props) => (
  <Icon {...props}>
    <path d="M5 12h14" />
  </Icon>
);

export const IconArrowLeft = (props) => (
  <Icon {...props}>
    <path d="m12 19-7-7 7-7" />
    <path d="M19 12H5" />
  </Icon>
);

export const IconArrowRight = (props) => (
  <Icon {...props}>
    <path d="M5 12h14" />
    <path d="m12 5 7 7-7 7" />
  </Icon>
);

export const IconCheck = (props) => (
  <Icon {...props}>
    <path d="M20 6 9 17l-5-5" />
  </Icon>
);

export const IconPencil = (props) => (
  <Icon {...props}>
    <path d="M21.17 6.83a2.83 2.83 0 0 0-4-4L3 17v4h4Z" />
    <path d="m15 5 4 4" />
  </Icon>
);

export const IconTrash = (props) => (
  <Icon {...props}>
    <path d="M3 6h18" />
    <path d="M8 6V4h8v2" />
    <path d="M19 6l-1 14H6L5 6" />
    <path d="M10 11v6" />
    <path d="M14 11v6" />
  </Icon>
);

// Drag handle for a reorderable row (routine builder). Lucide's grip-vertical: two columns
// of three dots, recognisable as "grab this" independent of any tooltip or label.
export const IconGripVertical = (props) => (
  <Icon {...props}>
    <circle cx="9" cy="5" r="1" />
    <circle cx="9" cy="12" r="1" />
    <circle cx="9" cy="19" r="1" />
    <circle cx="15" cy="5" r="1" />
    <circle cx="15" cy="12" r="1" />
    <circle cx="15" cy="19" r="1" />
  </Icon>
);

// The "?" affordance on a chart header. Lucide's circle-help: the dot is a
// separate 0-length path rather than a <circle> so it inherits the round cap
// and stays visible at 16px.
export const IconHelp = (props) => (
  <Icon {...props}>
    <circle cx="12" cy="12" r="10" />
    <path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3" />
    <path d="M12 17h.01" />
  </Icon>
);

// Empty-state illustration marks. Larger and lighter-weight than the inline
// icons above -- an empty state is the one place an icon carries real size.
export const IconInbox = (props) => (
  <Icon strokeWidth={1.5} {...props}>
    <path d="M22 12h-6l-2 3h-4l-2-3H2" />
    <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11Z" />
  </Icon>
);

export const IconDumbbell = (props) => (
  <Icon strokeWidth={1.5} {...props}>
    <path d="m6.5 6.5 11 11" />
    <path d="m21 21-1-1" />
    <path d="m3 3 1 1" />
    <path d="m18 22 4-4" />
    <path d="m2 6 4-4" />
    <path d="m3 10 7-7" />
    <path d="m14 21 7-7" />
  </Icon>
);

// Rest timer readout in the session bar. Lucide's "timer": the stopwatch crown, the dial, and a
// hand pointing UP-and-in from centre -- which matches the count-UP model rather than a countdown.
// The bar's number is deliberately bare digits (no "Rest" label) because Playwright's getByText is
// a case-insensitive substring and would collide with the Settings "Rest timer" toggle, so this
// glyph is what carries the meaning visually; the accessible name lives on the wrapping element.
export const IconTimer = (props) => (
  <Icon {...props}>
    <line x1="10" y1="2" x2="14" y2="2" />
    <line x1="12" y1="14" x2="15" y2="11" />
    <circle cx="12" cy="14" r="8" />
  </Icon>
);
