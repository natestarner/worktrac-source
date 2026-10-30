// When to ask for an App Store rating: after the 3rd finished workout on this device, then again
// after every 5 more, but never twice within 30 days.
//
// The moment is the end of a workout ("End workout" in EndWorkoutConfirmModal) that had at least
// one set in it. That is the calm point of a session: the work is done and the recap has just said
// what was done. A PR is the happier moment but the wrong one -- it lands mid-workout, usually with
// a rest timer running, and a system sheet over that is an interruption.
//
// What this does NOT know, and why it does not need to:
//   - Whether the person has rated. Apple reports nothing back. iOS's own limits cover it: at most
//     three sheets a year per app, normally none once someone has rated. Asking more often than
//     that is just asks iOS ignores.
//   - Whether the sheet appeared. A request iOS declined (or one made with no signal) still
//     counts as an ask, so the next one waits for 5 more workouts. Missing a chance costs nothing;
//     asking again on the very next workout would.
//
// Counted per DEVICE, not per person: the rating belongs to the Apple ID signed in to the phone,
// whoever in the household ended the workout. On the web the count still runs and the request does
// nothing (lib/native/review.js), so this is one code path everywhere.
//
// localStorage, synchronous, for the same reason as endedSessions.js: a reload or an app kill right
// after the End tap must not lose the count.
import { requestAppReview } from './native';

const KEY = 'huddle-review-prompt';

export const FIRST_ASK_AFTER = 3;
export const ASK_EVERY = 5;
export const MIN_DAYS_BETWEEN_ASKS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

// Long enough for the End dialog to close and the recap toast to be read before Apple's sheet
// covers the screen.
export const ASK_DELAY_MS = 1500;

function read() {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (parsed && Number.isInteger(parsed.ended)) return parsed;
  } catch {
    // Unreadable storage: start counting again, which can only delay an ask.
  }
  return { ended: 0, nextAskAt: FIRST_ASK_AFTER, lastAskedAt: null };
}

function write(state) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // Private mode / quota. Losing the count only delays the next ask; never throw into "End workout".
  }
}

/**
 * Records one finished workout and says whether this is the moment to ask. Pure apart from the
 * storage, so the schedule is testable without a timer or a plugin.
 */
export function noteWorkoutEnded({ setCount, now = Date.now() }) {
  // An empty workout (a mis-tap, a set logged and deleted) is not a workout anyone enjoyed.
  if (!(setCount > 0)) return false;
  const state = read();
  state.ended += 1;
  const cooledDown = state.lastAskedAt == null || now - state.lastAskedAt >= MIN_DAYS_BETWEEN_ASKS * DAY_MS;
  const due = state.ended >= state.nextAskAt && cooledDown;
  if (due) {
    state.lastAskedAt = now;
    state.nextAskAt = state.ended + ASK_EVERY;
  }
  write(state);
  return due;
}

/** Called once per "End workout" tap. Fire and forget: nothing waits on it and it never throws. */
export function askForReviewAfterWorkout({ setCount }) {
  if (!noteWorkoutEnded({ setCount })) return;
  setTimeout(() => {
    requestAppReview();
  }, ASK_DELAY_MS);
}
