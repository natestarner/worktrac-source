// A short physical acknowledgement at the two moments in a workout that deserve one: beating a
// personal record, and finishing. Nothing else -- a buzz on every logged set would be noise within
// one session, and this app is used for an hour at a time.
//
// ## The constraint that shapes all of this
//
// **`navigator.vibrate` does not exist in Safari on iOS.** Apple has never implemented the
// Vibration API, and this app is iPad- and iPhone-first. So the obvious implementation does
// nothing at all on the primary target, which is exactly the kind of feature that ships, looks
// done, and silently never fires for the person who asked for it.
//
// Two paths, tried in order, and the app is correct with neither:
//
//   1. `navigator.vibrate` -- real on Android/Chrome, absent on iOS, a no-op on desktop.
//   2. The iOS `<input type="checkbox" switch>` trick. iOS 17.4+ plays a light haptic when that
//      control toggles, and toggling a hidden one programmatically borrows it. It is a
//      **workaround, not an API**: undocumented for this purpose, dependent on a rendering
//      behaviour Apple can remove, and unverified inside an installed PWA. It is fenced off
//      accordingly (see `iosSwitchTick`) and must never be load-bearing.
//
// **Everything here is decoration.** No caller may depend on a buzz having happened, and every
// failure degrades to silence rather than to an error. That is why every path is wrapped and why
// `tryHaptic` swallows: a browser that throws on an unsupported call must not take a PR
// celebration down with it.
//
// ## Why `prefers-reduced-motion` gates it
//
// There is no `prefers-reduced-haptics`. Reduced-motion is the closest platform signal for "send
// me less non-essential feedback", and erring toward silence is the safe direction: someone who
// wanted a buzz and doesn't get one is mildly disappointed, while someone with a vestibular or
// sensory sensitivity who gets an unrequested one is worse off. This is a judgement call rather
// than a spec, and it is the first thing to revisit if anyone reports a missing buzz.

// Milliseconds. Short enough to read as a tick rather than an alert -- a PR is a good thing, and a
// long buzz is what phones use for errors and calls.
const PATTERNS = {
  // Two quick taps: "that was something". Used for a personal record.
  celebrate: [18, 60, 30],
  // One soft tap: an acknowledgement, not a fanfare. Used for ending a workout.
  complete: [24],
};

function prefersReducedMotion() {
  try {
    return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  } catch {
    return false;
  }
}

// iOS 17.4+ plays a system haptic when a `switch`-styled checkbox toggles. Clicking a hidden one
// borrows that, which is the only route to a haptic in Safari today.
//
// Deliberately narrow: it creates the element, toggles it, and removes it inside one call, so
// nothing persists in the DOM and nothing is left focusable or announceable. `aria-hidden` plus
// `tabIndex = -1` keep it out of the accessibility tree entirely -- a stray checkbox in the tab
// order would be a real regression traded for a decorative buzz.
function iosSwitchTick() {
  const input = document.createElement('input');
  input.type = 'checkbox';
  // The attribute is what triggers the behaviour; React would strip an unknown prop, which is one
  // reason this lives outside the component tree.
  input.setAttribute('switch', '');
  input.setAttribute('aria-hidden', 'true');
  input.tabIndex = -1;
  input.style.position = 'absolute';
  input.style.opacity = '0';
  input.style.pointerEvents = 'none';
  document.body.appendChild(input);
  try {
    input.click();
  } finally {
    input.remove();
  }
}

// True only where the switch attribute is actually understood. Safari reflects a supported
// `switch` attribute onto the element; browsers that don't know it leave the property undefined,
// so this is a feature test rather than a user-agent sniff.
function supportsIosSwitchHaptic() {
  try {
    const probe = document.createElement('input');
    probe.type = 'checkbox';
    return 'switch' in probe;
  } catch {
    return false;
  }
}

// Fire a haptic, if this device has one and the person hasn't asked for less. Returns which route
// was taken -- for tests and for an honest answer to "did anything happen?", never for a caller to
// branch on.
export function tryHaptic(pattern = 'complete') {
  const shape = PATTERNS[pattern] ?? PATTERNS.complete;
  try {
    if (prefersReducedMotion()) return 'suppressed';
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      // Returns false when the UA refuses (a background tab, a disallowed gesture context).
      return navigator.vibrate(shape) ? 'vibrate' : 'refused';
    }
    if (supportsIosSwitchHaptic()) {
      iosSwitchTick();
      return 'ios-switch';
    }
    return 'unsupported';
  } catch {
    // A haptic is decoration. It may never be the reason something else on screen failed.
    return 'error';
  }
}
