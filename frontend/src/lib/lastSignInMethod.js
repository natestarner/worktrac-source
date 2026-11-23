// The ways this DEVICE has signed in: the most recent one, so the sign-in screens can point at that
// button ("You last signed in with Apple"), and every one it has ever used, so the screens a mistake
// leads to (Forgot password, the new-person name step) can say which way in this device knows.
//
// Why it matters more here than as polish: an Apple "Hide My Email" relay address matches nothing
// else, so someone who signed up with Apple and later taps Google is a brand-new person to the
// server -- they get the name step and a second, empty household, and believe their training is
// gone. Pointing back at the way they used is the cheapest guard against that.
//
// Per device, not per person: it describes sign-ins on this screen, and it deliberately survives
// logout (that is the moment it is read). It names methods only, never an email or an account, so
// it needs no "trust this device" question: it tells whoever holds the device nothing about who
// signed in. A family iPad remembers everyone's ways in, which is why the list exists at all --
// a "last used" alone would point each person at the other's button. localStorage, read
// synchronously, so the hints are there on the first frame; every access is wrapped, because
// private mode or a full quota must never break signing in -- the hints just aren't shown.

const LAST_KEY = 'huddle-last-sign-in-method';
const ALL_KEY = 'huddle-sign-in-methods';
const METHODS = new Set(['apple', 'google', 'test', 'password']);

/** Records a sign-in that worked. Anything not in METHODS is ignored. */
export function rememberSignInMethod(method) {
  if (!METHODS.has(method)) return;
  // Read the list BEFORE moving the last-used key: on a device that predates the list, the old
  // last-used method is the only record of it, and overwriting it first would forget it.
  const used = usedSignInMethods();
  try {
    if (!used.includes(method)) localStorage.setItem(ALL_KEY, JSON.stringify([...used, method]));
  } catch {
    // Storage refused (private mode, quota): no hint next time, nothing else.
  }
  try {
    localStorage.setItem(LAST_KEY, method);
  } catch {
    // As above.
  }
}

/** 'apple' | 'google' | 'test' | 'password', or null when unknown, unreadable or unrecognised. */
export function lastSignInMethod() {
  try {
    const value = localStorage.getItem(LAST_KEY);
    return METHODS.has(value) ? value : null;
  } catch {
    return null;
  }
}

/**
 * Every way this device has signed in, oldest first, without repeats; [] when none or unreadable.
 * Includes the last-used method even if the list was never written: a device that signed in before
 * the list existed has only that key, and it is still a way in this device knows.
 */
export function usedSignInMethods() {
  let stored = [];
  try {
    const parsed = JSON.parse(localStorage.getItem(ALL_KEY) ?? '[]');
    if (Array.isArray(parsed)) stored = parsed.filter((m) => METHODS.has(m));
  } catch {
    stored = [];
  }
  const last = lastSignInMethod();
  const used = [...new Set(stored)];
  if (last && !used.includes(last)) used.push(last);
  return used;
}

/** What each method is called in a sentence ("You last signed in with Apple"). */
export const SIGN_IN_METHOD_NAMES = {
  apple: 'Apple',
  google: 'Google',
  test: 'Test provider',
  password: 'your email and password',
};

/** "Apple", "Apple or Google", "Apple, Google or your email and password". */
export function describeSignInMethods(methods) {
  const names = methods.map((m) => SIGN_IN_METHOD_NAMES[m]).filter(Boolean);
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}`;
}
