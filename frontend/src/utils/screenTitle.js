// The name of the screen someone is currently on, for the shell's single <h1>.
//
// axe's `page-has-heading-one` flagged the whole app: there is exactly ONE <h1> in the codebase
// (the Handbook's), because every other screen renders its title as a styled <div>. A screen
// reader therefore had no heading to jump to and no announcement of which screen it had landed on
// -- the tab bar changes, the content changes, and nothing says what happened.
//
// One derivation rather than an <h1> per route: the shell already knows the pathname, the tab bar
// already renders these exact five labels, and eleven separate headings would be eleven chances to
// drift. The five tab labels are duplicated from TabsNav's own TABS deliberately -- importing them
// would couple the shell's heading to a navigation component's rendering concerns, and this list
// is the accessible NAME of a screen rather than the text on a control.
const TITLES = {
  '/app/log': 'Log',
  '/app/history': 'History',
  '/app/prs': 'Personal records',
  '/app/routines': 'Routines',
  '/app/trends': 'Trends',
  '/app/settings': 'App settings',
  '/app/profile': 'Profile',
  '/app/billing': 'Plan and billing',
  '/app/contact': 'Contact us',
};

// Screens that render their OWN visible <h1>, for which the shell must add nothing.
//
// The comment above says the Handbook's is the one real <h1> in the app, and the first cut of this
// map then listed '/app/help' anyway -- so that screen got a visually hidden "Huddle Handbook"
// heading directly above its visible one. Two <h1>s naming the same screen is worse than the
// missing heading this file exists to fix: a screen reader announces the page twice, and it broke
// two Handbook e2e specs on `strict mode violation ... resolved to 2 elements`.
//
// This is a separate list rather than a `null` entry in TITLES because the title itself belongs to
// the screen that draws it. Putting "Huddle Handbook" here too would be a second copy of a string
// HelpTab already owns, free to drift from the one people actually see.
//
// Checked BEFORE the fallback below, or `/app/help` would resolve to the generic 'Huddle' and
// render a second <h1> regardless.
const OWN_HEADING = ['/app/help'];

// "Personal records" rather than "PRs" and "Plan and billing" rather than "Plan & billing": this
// string is read aloud, and a screen reader says "P R s" and "ampersand". The visible tab keeps
// its short label.
// Returns null when the screen provides its own <h1> -- the caller renders nothing in that case.
export function screenTitleFor(pathname) {
  if (!pathname) return 'Huddle';
  if (OWN_HEADING.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return null;
  // Exact match first, then longest prefix -- so a future nested route (/app/help#section, or
  // /app/settings/something) still resolves to its section rather than falling through.
  if (TITLES[pathname]) return TITLES[pathname];
  const prefix = Object.keys(TITLES)
    .filter((p) => pathname.startsWith(`${p}/`))
    .sort((a, b) => b.length - a.length)[0];
  return prefix ? TITLES[prefix] : 'Huddle';
}
