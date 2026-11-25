// "Last month", "two years ago" -- counted from the account's DATA, not the calendar.
//
// The lower account was seeded once (five years ending 2026-09-25) and only ever topped up below
// 1,500 workouts, so its History never moves forward by itself. Scenarios pick "a finished workout
// last month"; counted from today, that month went empty in November 2026 and every drain scenario
// failed before it started ("the device holds no finished workout in 2026-10") -- the harness, not
// the app. Counting from the month after the newest finished workout keeps every pick inside the
// data however old it gets, and is identical to counting from today while the data is current.

// The month after the newest finished workout, as a date in that month -- or today, if sooner.
export function dataAnchor(history, today = new Date()) {
  const newest = history.find((s) => s.endedAt !== null && s.endedAt !== undefined);
  if (!newest) return today;
  const after = new Date(newest.startedAt);
  after.setUTCDate(15);
  after.setUTCMonth(after.getUTCMonth() + 1);
  return after < today ? after : today;
}

// `n` months before the anchor, as 'yyyy-mm' (mid-month, so month lengths can't skip one).
export function monthsBackFrom(anchor) {
  return (n) => {
    const d = new Date(anchor);
    d.setUTCDate(15);
    d.setUTCMonth(d.getUTCMonth() - n);
    return d.toISOString().slice(0, 7);
  };
}
