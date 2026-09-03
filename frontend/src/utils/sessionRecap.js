// Ending a workout used to say only "Workout ended. Logging a set anytime starts a new one." --
// a state transition, while the session's own numbers sat unused in the cache. This turns that
// moment into an acknowledgement of what was actually done.
//
// Pure and hook-free (modelled on utils/formulas.js and components/trends/exerciseMetrics.js) so
// the wording can be unit tested without rendering anything, and so the modal and the toast are
// formatting from ONE derivation rather than two that can drift.
//
// Warmth here is carried by naming the work, not by praising it: "3 exercises · 12 sets · 47 min"
// tells you something true that you would otherwise have to go and look up. A "Nice work!" would
// be the gamification the design system deliberately avoids.

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;

function plural(n, word) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

// Whole minutes under an hour, then "1 hr 12 min". Never seconds: a workout measured in seconds is
// noise, and `null` below suppresses the whole clause for one that short.
export function formatWorkoutDuration(elapsedMs) {
  if (!Number.isFinite(elapsedMs) || elapsedMs < MINUTE_MS) return null;
  const hours = Math.floor(elapsedMs / HOUR_MS);
  const minutes = Math.floor((elapsedMs % HOUR_MS) / MINUTE_MS);
  if (hours === 0) return `${minutes} min`;
  if (minutes === 0) return `${hours} hr`;
  return `${hours} hr ${minutes} min`;
}

// Returns null when there is nothing worth reporting, and the caller then says nothing rather than
// "0 exercises · 0 sets". Ending a workout you logged nothing into is a real case -- a mis-tap on
// "Log set" that was then deleted, or a session started by someone else's set on a shared device --
// and congratulating it would be worse than staying quiet.
export function formatSessionRecap({ exerciseCount = 0, setCount = 0, elapsedMs = null } = {}) {
  if (setCount <= 0) return null;
  const parts = [plural(exerciseCount, 'exercise'), plural(setCount, 'set')];
  const duration = formatWorkoutDuration(elapsedMs);
  if (duration) parts.push(duration);
  return parts.join(' · ');
}

// Milliseconds from a session's start to now, or null when the start is missing or nonsensical.
// A provisional offline session carries the client's own clientLoggedAt as startedAt, so this is
// honest in every connectivity mode -- see SessionBar's header comment.
export function sessionElapsedMs(startedAt, now = Date.now()) {
  if (!startedAt) return null;
  const started = new Date(startedAt).getTime();
  if (!Number.isFinite(started)) return null;
  const elapsed = now - started;
  // A negative elapsed means the device clock moved backwards between the set and now (a manual
  // clock change, or an NTP correction). Reporting "-3 min" is worse than reporting no duration.
  return elapsed >= 0 ? elapsed : null;
}
