import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';

// Press-and-hold auto-repeat for a stepper button. THE hold mechanism -- it lives here, and
// WeightRepsStepper is its only consumer, so the log screen and EditSetModal cannot drift apart.
// A second hold implementation elsewhere is the bug (.claude/rules/resilience.md).
//
// ## onClick is deliberately untouched
//
// The repeat layers on via onPointerDown; a tap never reaches HOLD_DELAY_MS, so Playwright's
// .click() and RTL's fireEvent.click keep producing exactly one step. That is what let this ship
// without editing the ~15 e2e specs and 3 unit files that drive these buttons.
//
// ## Why setTimeout and not setInterval
//
// Two reasons, and either alone is sufficient. The cadence CHANGES every tick (it accelerates), and
// iOS delivers a backlog of coalesced interval callbacks in one burst when a throttled tab wakes --
// on a weight stepper that burst is a pile of steps nobody asked for. A self-rescheduling timeout
// can only ever be one tick behind, and the document.hidden check below discards even that one.
//
// ## FLOOR_INTERVAL_MS is a rate limit, not a feel preference -- do not tighten it
//
// Every tick calls onRepeat, which on the log screen dispatches SET_DRAFT into AppStateContext:
// ~22 context consumers re-render and appStatePersistence synchronously stringifies and writes the
// whole byPerson map to localStorage. ~10/s is inside the envelope appStatePersistence.js already
// documents and accepts for exercise-search keystrokes. 16/s (a 60ms floor) is outside it and buys
// nothing a thumb can use.
const HOLD_DELAY_MS = 500;
const FIRST_INTERVAL_MS = 260;
const FLOOR_INTERVAL_MS = 100;
const RAMP_MS = 1200;

// Derived from the wall clock rather than from a tick count, for the reason UIContext's ticker
// documents: a suspended tab resumes with a count that never advanced, and reading the clock is the
// only thing that stays honest across it.
function intervalAt(heldMs) {
  const progress = Math.min(1, Math.max(0, (heldMs - HOLD_DELAY_MS) / RAMP_MS));
  return Math.round(FIRST_INTERVAL_MS + (FLOOR_INTERVAL_MS - FIRST_INTERVAL_MS) * progress);
}

// Nothing observed yet -- distinct from any real value, including null and undefined, which are
// both legitimate things to be watching.
const NOTHING_OBSERVED = Symbol('nothing-observed');

// onRepeat: the step to repeat. Called with NO arguments -- this hook never computes a value, it
//   only calls the same handler a tap calls, so it is structurally incapable of producing a number
//   a tap could not.
// watch: the value that step is expected to move. Owned by the caller so this stays step-agnostic;
//   used only to notice that it has STOPPED moving.
// floor: true when the caller knows another step would be pointless or unwanted. The primary stop;
//   watch is the backstop under it.
// enabled: false makes onPointerDown inert. onClick is unaffected either way.
export default function useHoldRepeat({ onRepeat, watch, floor = false, enabled = true }) {
  // Refreshed at COMMIT, never during render: a render can be discarded under concurrent rendering
  // and runs twice under StrictMode, so a render-phase write is an impure side effect. A layout
  // effect is synchronous at commit, which is strictly before any later timer callback -- the only
  // ordering this needs. Without it a tick calls the closure from the render that STARTED the hold
  // and steps the same value forever.
  const latest = useRef({ onRepeat, watch, floor, enabled });
  useLayoutEffect(() => {
    latest.current = { onRepeat, watch, floor, enabled };
  });

  const timerRef = useRef(null);
  const activeRef = useRef(false);
  const repeatedRef = useRef(false);
  const observedRef = useRef(NOTHING_OBSERVED);
  const startedAtRef = useRef(0);

  // The exact function identity registered on window, so stop() can remove what it added. Held in
  // a ref rather than reusing stop itself, which would make stop reference itself before it is
  // initialized.
  const listenerRef = useRef(null);

  const stop = useCallback(() => {
    activeRef.current = false;
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    // Guarded rather than unconditional, so stop() is safe to call twice -- and it is, whenever
    // pointerup and pointercancel both arrive, and again on unmount.
    if (listenerRef.current) {
      window.removeEventListener('pointerup', listenerRef.current);
      window.removeEventListener('pointercancel', listenerRef.current);
      window.removeEventListener('blur', listenerRef.current);
      listenerRef.current = null;
    }
  }, []);

  // A NAMED function expression: the reschedule below refers to the function itself rather than
  // to the `tick` const, which is still initializing while this body is being defined.
  const tick = useCallback(function tickOnce() {
    timerRef.current = null;
    if (!activeRef.current) return;
    // A backgrounded tab's timers are throttled, then delivered late. Checking here rather than via
    // a visibilitychange listener means zero stray steps and nothing to unsubscribe.
    if (typeof document !== 'undefined' && document.hidden) {
      stop();
      return;
    }

    const { onRepeat: repeat, watch: current, floor: atFloor } = latest.current;

    // The floor the caller declared. Checked BEFORE repeating, so a hold that begins at the floor
    // performs no steps and -- because repeatedRef stays false -- does not swallow its own trailing
    // click. Holding at the floor then behaves exactly like tapping there.
    if (atFloor) {
      stop();
      return;
    }

    // The backstop under floor: a floor is supplied by a call site and a call site can forget one.
    // Stopping when the value has stopped moving (or has gone blank) makes a forgotten floor a
    // premature stop -- recoverable by pressing again -- rather than a runaway. It earns its place
    // on exactly one control: ExerciseDetail's duration decrement walks
    // 10 -> 5 -> null -> 25 -> 20 -> ... forever, because durationValue re-defaults a blank to 30.
    if (observedRef.current !== NOTHING_OBSERVED) {
      if (current === null || current === undefined || Object.is(current, observedRef.current)) {
        stop();
        return;
      }
    }
    observedRef.current = current;

    repeatedRef.current = true;
    repeat();
    timerRef.current = setTimeout(tickOnce, intervalAt(Date.now() - startedAtRef.current));
  }, [stop]);

  const onPointerDown = useCallback(
    (event) => {
      // Secondary buttons (right/middle) never start a hold. No isPrimary guard: jsdom defaults
      // PointerEvent.isPrimary to false, so guarding on it would make every unit-test press a
      // silent no-op -- a vacuous-pass generator.
      if (event && event.button > 0) return;
      if (activeRef.current) return;
      if (!latest.current.enabled) return;

      repeatedRef.current = false;
      observedRef.current = NOTHING_OBSERVED;
      activeRef.current = true;
      startedAtRef.current = Date.now();

      // On window, not on the button. Touch pointers get IMPLICIT pointer capture at pointerdown,
      // so a finger that slides off still delivers pointerup to the element -- but a mouse does
      // not, and setPointerCapture is not implemented in jsdom, so a window listener is the one
      // mechanism that covers both and stays testable. Deliberately no pointerleave: touch cannot
      // report it at all (implicit capture suppresses boundary events), so wiring it would give
      // mouse and touch different stop conditions for the same gesture. The rule is uniform --
      // the repeat runs until you lift.
      const listener = () => stop();
      listenerRef.current = listener;
      window.addEventListener('pointerup', listener);
      window.addEventListener('pointercancel', listener);
      window.addEventListener('blur', listener);

      timerRef.current = setTimeout(tick, HOLD_DELAY_MS);
    },
    [stop, tick],
  );

  // Read-and-reset. The caller asks this from onClick to swallow the trailing click of a press that
  // repeated: without it a one-second hold lands N repeats PLUS one more step on release. Also
  // reset on pointerdown, so a press that ended outside the button (no click ever arrives) cannot
  // leave the flag armed for an unrelated later click.
  const wasRepeating = useCallback(() => {
    const was = repeatedRef.current;
    repeatedRef.current = false;
    return was;
  }, []);

  // A timer firing into a torn-down environment is how Button.jsx's stray setTimeout produced an
  // intermittently red frontend-ci: all tests passing, one unhandled error, exit 1.
  useEffect(() => stop, [stop]);

  return { onPointerDown, wasRepeating };
}
