// Grid maths for ConsistencyHeatmap, kept out of the component so the day alignment and the
// intensity thresholds can be unit tested without rendering.

export const HEATMAP_WEEKS = 26;
export const DAYS_PER_WEEK = 7;

// Intensity by sets logged that day. Fixed thresholds rather than quantiles of the person's own
// history: a quantile scale silently redefines what "dark" means every time the data shifts, so
// two people (or the same person across months) can't be compared. At household scale a plain
// "how many sets was that" reading is what someone actually wants.
const LEVEL_THRESHOLDS = [5, 12, 20]; // <=5 -> 1, <=12 -> 2, <=20 -> 3, else 4

export function intensityLevel(setCount) {
  if (!setCount) return 0;
  for (let i = 0; i < LEVEL_THRESHOLDS.length; i += 1) {
    if (setCount <= LEVEL_THRESHOLDS[i]) return i + 1;
  }
  return LEVEL_THRESHOLDS.length + 1;
}

function toKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// Monday of the week containing `date`. The backend buckets weeks on Monday
// (StatsService uses DayOfWeek.MONDAY), so the grid's rows have to start there too or the
// heatmap and the weekly bar charts would disagree about which days belong to which week.
export function mondayOf(date) {
  const monday = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const offset = (monday.getDay() + 6) % 7; // Sunday(0) is 6 days into a Monday-start week
  monday.setDate(monday.getDate() - offset);
  return monday;
}

// 26 columns x 7 rows ending with the current week, as a flat column-major list. Cells after today
// are `future: true` -- the rest of this week exists in the grid but hasn't happened yet, and
// painting it as "no workout" would read as a miss.
//
// workoutDays is the backend's list of active days only, so every blank square is filled in here.
export function buildGrid(workoutDays, today = new Date()) {
  const byDate = new Map((workoutDays || []).map((d) => [d.date, d]));
  const todayKey = toKey(today);
  const start = mondayOf(today);
  start.setDate(start.getDate() - (HEATMAP_WEEKS - 1) * DAYS_PER_WEEK);

  const cells = [];
  for (let week = 0; week < HEATMAP_WEEKS; week += 1) {
    for (let day = 0; day < DAYS_PER_WEEK; day += 1) {
      const date = new Date(start.getFullYear(), start.getMonth(), start.getDate());
      date.setDate(date.getDate() + week * DAYS_PER_WEEK + day);
      const key = toKey(date);
      const entry = byDate.get(key);
      cells.push({
        key,
        date,
        week,
        day,
        future: key > todayKey,
        sessionCount: entry?.sessionCount ?? 0,
        setCount: entry?.setCount ?? 0,
        level: intensityLevel(entry?.setCount ?? 0),
      });
    }
  }
  return cells;
}

// One label per column that starts a new month, for the strip above the grid. Columns that don't
// begin a month get an empty string so the label row stays column-aligned with the grid.
export function monthLabels(cells) {
  const labels = new Array(HEATMAP_WEEKS).fill('');
  let lastMonth = null;
  for (let week = 0; week < HEATMAP_WEEKS; week += 1) {
    const firstOfColumn = cells[week * DAYS_PER_WEEK];
    if (!firstOfColumn) continue;
    const month = firstOfColumn.date.getMonth();
    if (month !== lastMonth) {
      labels[week] = firstOfColumn.date.toLocaleDateString('en-US', { month: 'short' });
      lastMonth = month;
    }
  }
  return labels;
}
