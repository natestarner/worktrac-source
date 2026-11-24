import { useEffect, useMemo, useRef, useState } from 'react';
import { buildGrid, monthLabels, DAYS_PER_WEEK, HEATMAP_WEEKS } from './consistencyGrid';
import { localeFormat } from '../../utils/datetime';
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
// The largest a square grows to on a wide screen (see cellSize below): at 28px an iPad held
// sideways fills ~80% of the card and portrait fills it. Then the space between the weekday
// labels and the grid.
const MAX_CELL = 28;
const LABELS_GAP = 6;

// Mon/Wed/Fri only -- seven stacked labels at 10px rows is unreadable.
const DAY_LABELS = ['Mon', '', 'Wed', '', 'Fri', '', ''];

function levelColor(level) {
  return `var(--chart-heat-${level})`;
}

function describe(cell) {
  const date = localeFormat(cell.date, { weekday: 'short', month: 'short', day: 'numeric' });
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
  // a real-browser-only effect, proven in e2e (trends.spec.ts).
  useEffect(() => {
    const node = scrollRef.current;
    if (node) node.scrollLeft = node.scrollWidth;
  }, []);

  // The squares grow to fill a wide card. At a fixed 10px the 26 weeks took ~340px, which on an
  // iPad left two thirds of the card empty and read as unfinished. On a phone the width works out
  // below CELL, so the floor keeps today's 10px squares and the scroll-to-today above. Measured,
  // not a breakpoint, because the card's width depends on orientation and the tab panel's cap.
  // jsdom has no ResizeObserver, and there the grid simply stays at CELL.
  const labelsRef = useRef(null);
  const [cellSize, setCellSize] = useState(CELL);
  useEffect(() => {
    const node = scrollRef.current;
    if (!node || typeof ResizeObserver === 'undefined') return undefined;
    const measure = () => {
      const labelsWidth = labelsRef.current?.offsetWidth ?? 0;
      const available = node.clientWidth - labelsWidth - LABELS_GAP;
      const fit = Math.floor((available - (HEATMAP_WEEKS - 1) * GAP) / HEATMAP_WEEKS);
      setCellSize(Math.max(CELL, Math.min(MAX_CELL, fit)));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
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
        {/* Centred when it doesn't fill the card (an iPad held sideways, at the MAX_CELL cap), so the
            space left over is even rather than all on the right. When it overflows (a phone),
            auto margins resolve to 0 and the scroll-to-today above is unchanged. */}
        <div style={{ display: 'flex', gap: LABELS_GAP, minWidth: 'min-content', width: 'fit-content', margin: '0 auto' }}>
          {/* Sticky within the scroll container (not the page), so the weekday labels stay
              readable at whatever week someone has scrolled to. Needs its own background -- it's
              sitting in front of grid cells now, not beside them. */}
          <div
            ref={labelsRef}
            data-testid="consistency-day-labels"
            style={{
              display: 'grid',
              gridTemplateRows: `repeat(${DAYS_PER_WEEK}, ${cellSize}px)`,
              gap: GAP,
              paddingTop: 16,
              position: 'sticky',
              left: 0,
              background: 'var(--color-surface)',
              zIndex: 1,
            }}
          >
            {DAY_LABELS.map((label, i) => (
              <div key={i} style={{ fontSize: 9, lineHeight: `${cellSize}px`, color: 'var(--color-muted)', textAlign: 'right' }}>
                {label}
              </div>
            ))}
          </div>

          <div>
            <div style={{ display: 'grid', gridTemplateColumns: `repeat(${HEATMAP_WEEKS}, ${cellSize + GAP}px)`, height: 16 }}>
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
                gridTemplateRows: `repeat(${DAYS_PER_WEEK}, ${cellSize}px)`,
                gridAutoFlow: 'column',
                gridAutoColumns: `${cellSize}px`,
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
                    width: cellSize,
                    height: cellSize,
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
