// Session/set timestamps are stored and transmitted as UTC ISO strings; every date/time
// input, display label, and edit round-trip must convert to/from the viewer's local
// time here -- never slice a UTC ISO string directly for an <input> value.

export function toLocalDateStr(iso) {
  const d = new Date(iso);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function toLocalTimeStr(iso) {
  const d = new Date(iso);
  const h = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${h}:${mi}`;
}

export function localDateTimeToIso(dateStr, timeStr) {
  const [y, mo, d] = dateStr.split('-').map(Number);
  const [hh, mm] = timeStr.split(':').map(Number);
  return new Date(y, mo - 1, d, hh, mm, 0, 0).toISOString();
}

// The same local date+time pair as epoch millis, and NULL rather than a throw when either input is
// incomplete. Both exist on purpose: localDateTimeToIso is called from submit handlers, where an
// unparseable date is a bug worth surfacing, while this is called during RENDER as someone types
// into an <input type="date"> -- which is empty or half-written for several keystrokes, and where
// `new Date(NaN).toISOString()` throws a RangeError that would take the whole tab down.
export function localDateTimeToMs(dateStr, timeStr) {
  const [y, mo, d] = String(dateStr ?? '').split('-').map(Number);
  const [hh, mm] = String(timeStr ?? '').split(':').map(Number);
  const ms = new Date(y, mo - 1, d, hh, mm, 0, 0).getTime();
  return Number.isNaN(ms) ? null : ms;
}

export function formatDateLabel(localDateStr) {
  const today = toLocalDateStr(new Date().toISOString());
  const y = new Date();
  y.setDate(y.getDate() - 1);
  const yesterday = toLocalDateStr(y.toISOString());
  if (localDateStr === today) return 'Today';
  if (localDateStr === yesterday) return 'Yesterday';
  const [yy, mm, dd] = localDateStr.split('-').map(Number);
  const d = new Date(yy, mm - 1, dd);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function formatTime(iso) {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

export function formatRestTime(sec) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

// The shortest hold that can be logged, and it is a backend constraint rather than a taste call:
// LogSetRequest/EditSetRequest declare durationSeconds @Min(1). A 0 is therefore a 400, and a
// definitive 4xx is the one thing that ends a durable write's retries (shouldRetryWrite) -- so a
// hold logged at 0:00 isn't rejected with a chance to fix it, it is discarded for good behind a
// "Couldn't save that set" toast. Every control that can produce a duration clamps to this, and
// they must agree: the ± steppers, the DurationWheel, and the value handed to handleLogSet.
export const MIN_HOLD_SECONDS = 1;

// formatRestTime's inverse, and deliberately permissive about which of the two shapes it gets.
//
// Both have to work, because which one a person can type depends on their keyboard: "1:30" is the
// natural thing to write on a desktop and matches what the field displays, while a phone's numeric
// keypad has no colon at all, so on mobile the only thing you CAN type is a raw second count.
// Accepting either means neither platform has a worse experience than the other.
//
//   "1:30" -> 90     "90" -> 90      "2:" -> 120     ":45" -> 45      "1:5" -> 65
//
// Anything unparseable is 0, matching the plain numeric steppers' `parseFloat(raw) || 0`: a blank
// is a display state, never a validation gate that blocks logging.
export function parseDuration(raw) {
  const text = String(raw ?? '').trim();
  if (!text) return 0;
  if (!text.includes(':')) {
    return Math.max(0, Math.round(parseFloat(text) || 0));
  }
  const [minutePart, secondPart] = text.split(':');
  const minutes = parseInt(minutePart, 10) || 0;
  const seconds = parseInt(secondPart, 10) || 0;
  return Math.max(0, minutes * 60 + seconds);
}

// Full date+time label for timestamps that can be arbitrarily old (admin portal signup/
// activity dates) -- formatDateLabel's "Today"/"Yesterday" relative framing only makes
// sense for recent workout activity. Handles null (e.g. an account with no sessions yet
// has no lastActivityAt).
// Date with no time of day, for things measured in days rather than minutes -- a subscription
// renewal or end date. Lives here rather than as an inline toLocaleDateString at the call site so
// every date the app renders keeps going through this module.
export function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function formatDateTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}
