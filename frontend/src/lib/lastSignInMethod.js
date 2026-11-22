// The way this DEVICE last signed in, so the sign-in screens can mark that button "Last used"
// (the pattern Slack, Notion and Figma use).
//
// Why it matters more here than as polish: an Apple "Hide My Email" relay address matches nothing
// else, so someone who signed up with Apple and later taps Google is a brand-new person to the
// server -- they get the name step and a second, empty household, and believe their training is
// gone. Pointing back at the button they used is the cheapest guard against that.
//
// Per device, not per person: it describes the last sign-in on this screen, and it deliberately
// survives logout (that is the moment it is read). It names a method only, never an email or an
// account. localStorage, read synchronously, so the hint is there on the first frame; every access
// is wrapped, because private mode or a full quota must never break signing in -- the hint just
// isn't shown.

const KEY = 'huddle-last-sign-in-method';
const METHODS = new Set(['apple', 'google', 'test', 'password']);

/** Records a sign-in that worked. Anything not in METHODS is ignored. */
export function rememberSignInMethod(method) {
  if (!METHODS.has(method)) return;
  try {
    localStorage.setItem(KEY, method);
  } catch {
    // Storage refused (private mode, quota): no hint next time, nothing else.
  }
}

/** 'apple' | 'google' | 'test' | 'password', or null when unknown, unreadable or unrecognised. */
export function lastSignInMethod() {
  try {
    const value = localStorage.getItem(KEY);
    return METHODS.has(value) ? value : null;
  } catch {
    return null;
  }
}
