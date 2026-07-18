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

// Full date+time label for timestamps that can be arbitrarily old (admin portal signup/
// activity dates) -- formatDateLabel's "Today"/"Yesterday" relative framing only makes
// sense for recent workout activity. Handles null (e.g. an account with no sessions yet
// has no lastActivityAt).
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
