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
  '/app/help': 'Huddle Handbook',
  '/app/contact': 'Contact us',
};

// "Personal records" rather than "PRs" and "Plan and billing" rather than "Plan & billing": this
// string is read aloud, and a screen reader says "P R s" and "ampersand". The visible tab keeps
// its short label.
export function screenTitleFor(pathname) {
  if (!pathname) return 'Huddle';
  // Exact match first, then longest prefix -- so a future nested route (/app/help#section, or
  // /app/settings/something) still resolves to its section rather than falling through.
  if (TITLES[pathname]) return TITLES[pathname];
  const prefix = Object.keys(TITLES)
    .filter((p) => pathname.startsWith(`${p}/`))
    .sort((a, b) => b.length - a.length)[0];
  return prefix ? TITLES[prefix] : 'Huddle';
}
