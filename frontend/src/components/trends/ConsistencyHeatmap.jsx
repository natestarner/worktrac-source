import { useEffect, useMemo, useRef, useState } from 'react';
import { buildGrid, monthLabels, DAYS_PER_WEEK, HEATMAP_WEEKS } from './consistencyGrid';
import ChartHelp from '../shared/ChartHelp';
import { CONSISTENCY_HELP } from './chartHelp';
import Card from '../shared/Card';

// Deliberately plain DOM rather than recharts: a day-grid isn't a plot, and staying out of
// recharts means this is the one Trends chart that can be asserted on for real in jsdom (the
// others need layout, so their tests mock them out -- see TrendsTab.test.jsx).
//
// Always a fixed trailing 26 weeks, NOT the range toggle -- 4 columns reads as broken and 260 is
// unusable on a phone. See StatsService.HEATMAP_DAYS.

const CELL = 10;
const GAP = 3;
const COLUMN = CELL + GAP;

// Mon/Wed/Fri only -- seven stacked labels at 10px rows is unreadable.
const DAY_LABELS = ['Mon', '', 'Wed', '', 'Fri', '', ''];

function levelColor(level) {
  return `var(--chart-heat-${level})`;
}

function describe(cell) {
  const date = cell.date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  if (cell.future) return `${date}, upcoming`;
  if (!cell.setCount) return `${date}, rest day`;
  const sets = `${cell.setCount} set${cell.setCount === 1 ? '' : 's'}`;
  const workouts = cell.sessionCount === 1 ? '1 workout' : `${cell.sessionCount} workouts`;
  return `${date}: ${sets} across ${workouts}`;
}

function Legend() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--color-muted)' }}>
      <span>Less</span>
      {[0, 1, 2, 3, 4].map((level) => (
        <span
          key={level}
          style={{ width: CELL, height: CELL, borderRadius: 2, background: levelColor(level), display: 'inline-block' }}
        />
      ))}
      <span>More</span>
    </div>
  );
}

export default function ConsistencyHeatmap({ workoutDays }) {
  const [activeKey, setActiveKey] = useState(null);
  const scrollRef = useRef(null);

  const cells = useMemo(() => buildGrid(workoutDays), [workoutDays]);
  const labels = useMemo(() => monthLabels(cells), [cells]);

  const activeCell = cells.find((c) => c.key === activeKey) || null;
  const activeDays = cells.filter((c) => c.setCount > 0).length;

  // The grid always ends at today, so on a phone narrow enough to scroll it, the interesting
  // edge is the right one -- open there rather than making someone swipe past 6 months of the
  // past to reach the present. jsdom lays out nothing, so scrollWidth is always 0 there; this is
  // a real-browser-only effect, proven in e2e (trends.spec.ts), same as ChartHelp's clamp.
  useEffect(() => {
    const node = scrollRef.current;
    if (node) node.scrollLeft = node.scrollWidth;
  }, []);

  return (
    <Card size="dense">
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, marginBottom: 12 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-muted)' }}>Consistency &middot; last 6 months</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <div style={{ fontSize: 13, color: 'var(--color-muted)' }}>
            {activeDays} active day{activeDays === 1 ? '' : 's'}
          </div>
          <ChartHelp help={CONSISTENCY_HELP} />
        </div>
      </div>

      {/* Narrow phones scroll the grid rather than squeezing the squares below tap size. */}
      <div ref={scrollRef} data-testid="consistency-scroll" style={{ overflowX: 'auto', paddingBottom: 4 }}>
        <div style={{ display: 'flex', gap: 6, minWidth: 'min-content' }}>
          {/* Sticky within the scroll container (not the page), so the weekday labels stay
              readable at whatever week someone has scrolled to. Needs its own background -- it's
              sitting in front of grid cells now, not beside them. */}
          <div
            data-testid="consistency-day-labels"
            style={{
              display: 'grid',
              gridTemplateRows: `repeat(${DAYS_PER_WEEK}, ${CELL}px)`,
              gap: GAP,
              paddingTop: 16,
              position: 'sticky',
              left: 0,
              background: 'var(--color-surface)',
              zIndex: 1,
            }}
          >
            {DAY_LABELS.map((label, i) => (
              <div key={i} style={{ fontSize: 9, lineHeight: `${CELL}px`, color: 'var(--color-muted)', textAlign: 'right' }}>
                {label}
              </div>
            ))}
          </div>

          <div>
            <div style={{ display: 'grid', gridTemplateColumns: `repeat(${HEATMAP_WEEKS}, ${COLUMN}px)`, height: 16 }}>
              {labels.map((label, i) => (
                <div key={i} style={{ fontSize: 9, color: 'var(--color-muted)', whiteSpace: 'nowrap' }}>
                  {label}
                </div>
              ))}
            </div>

            <div
              data-testid="consistency-grid"
              style={{
                display: 'grid',
                gridTemplateRows: `repeat(${DAYS_PER_WEEK}, ${CELL}px)`,
                gridAutoFlow: 'column',
                gridAutoColumns: `${CELL}px`,
                gap: GAP,
              }}
            >
              {cells.map((cell) => (
                <button
                  key={cell.key}
                  type="button"
                  data-testid={`heat-${cell.key}`}
                  data-level={cell.future ? 'future' : cell.level}
                  aria-label={describe(cell)}
                  onMouseEnter={() => setActiveKey(cell.key)}
                  onMouseLeave={() => setActiveKey(null)}
                  onFocus={() => setActiveKey(cell.key)}
                  onBlur={() => setActiveKey(null)}
                  onClick={() => setActiveKey(cell.key)}
                  style={{
                    width: CELL,
                    height: CELL,
                    padding: 0,
                    borderRadius: 2,
                    cursor: 'pointer',
                    background: cell.future ? 'transparent' : levelColor(cell.level),
                    // A 2px surface-coloured ring on the active square, matching how the trend
                    // chart's PR dots separate an emphasized mark from its neighbours.
                    border: cell.key === activeKey ? '2px solid var(--color-text)' : '1px solid transparent',
                  }}
                />
              ))}
            </div>
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginTop: 12, flexWrap: 'wrap' }}>
        <div aria-live="polite" style={{ fontSize: 13, color: 'var(--color-muted)', minHeight: 18 }}>
          {activeCell ? describe(activeCell) : ''}
        </div>
        <Legend />
      </div>
    </Card>
  );
}
