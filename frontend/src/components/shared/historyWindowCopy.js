// The vocabulary for "your full history goes back further than this screen", in one place, so the
// three tab notices, the explainer modal and PastSessionModal's warning cannot drift apart about
// what the limit is or how it is described. Same rule planCopy.js follows for the plan itself.
//
// Note the deliberate split between engineering names and product voice: the server field really is
// `hiddenSessions`, because that is precisely what it counts and an API should say what it means.
// None of that word reaches a person -- see fullHistorySentence.
//
// EVERY NUMBER HERE COMES FROM THE SERVER. The window length is derived from the `windowStart` the
// backend reports, never written down as 90 -- a literal here would be a second copy of
// SubscriptionService.FREE_HISTORY_WINDOW, and the copy is the half nobody would think to update.

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// How long the visible window is, in days, derived from the floor the server reported. Rounded
// because `windowStart` is an instant and "89.97 days" is not a thing to say to a person.
export function windowDays(windowStart, now = Date.now()) {
  if (!windowStart) return null;
  const days = Math.round((now - new Date(windowStart).getTime()) / MS_PER_DAY);
  return days > 0 ? days : null;
}

// "the last 90 days", with the 90 coming from the server's floor.
export function windowLabel(windowStart, now = Date.now()) {
  const days = windowDays(windowStart, now);
  return days ? `the last ${days} days` : 'a limited window';
}

// The count sentence every notice ends with.
//
// FRAMED AS WHAT THEY HAVE, NEVER AS WHAT THE APP IS WITHHOLDING. An earlier draft read "47 earlier
// workouts are saved but hidden on Free", which casts the app as the thing keeping someone from
// their own training -- true of the window, but the wrong posture for a product whose central
// promise is that it never deletes anything. "Your full history has 47 more workouts" says the same
// thing as a fact about them, and leaves the invitation to the "See Pro" link beside it.
//
// Singular is spelled out rather than left as "1 more workouts" -- this is the sentence asking
// someone for money, and it should read like someone wrote it.
export function fullHistorySentence(hiddenSessions) {
  return hiddenSessions === 1
    ? 'Your full history has 1 more workout.'
    : `Your full history has ${hiddenSessions} more workouts.`;
}

// Whether a Trends range reaches back past the window -- i.e. whether the range toggle is currently
// promising more than the charts can show. 4wk and 12wk sit inside a 90-day window and are
// therefore complete; "All" is not.
export function rangeReachesPastWindow(weeks, windowStart, now = Date.now()) {
  const days = windowDays(windowStart, now);
  return Boolean(days) && weeks * 7 > days;
}
