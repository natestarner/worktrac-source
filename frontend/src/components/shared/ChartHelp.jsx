import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import IconButton from './IconButton';
import { IconHelp } from './icons';

// Gap kept between the panel and the edge of the screen when it has to be nudged back on.
const VIEWPORT_MARGIN = 8;

// A "?" on a chart header that opens a plain-English explanation of what the marks mean.
//
// TAP TO OPEN, not hover. This app is used one-handed on an iPad mid-workout, where hover does
// not exist -- and on iOS a hover-opened panel would stick open after a tap until something else
// was touched, which is exactly what the `@media (hover: hover)` guard in index.css exists to
// avoid. One mechanism serves both input types; IconButton's `title` still gives a mouse user the
// label on hover.
//
// `help` is a { label, title, lines[] } object rather than children so the copy can live beside
// the metric definition it describes (see trends/chartHelp.js) and be unit tested without a
// render. `label` travels with it because the four labels on this screen have to be checked
// against each other for substring collisions, which is easier where they sit side by side.
export default function ChartHelp({ help }) {
  const [open, setOpen] = useState(false);
  const [shiftX, setShiftX] = useState(0);
  const containerRef = useRef(null);
  const panelRef = useRef(null);

  // Same close-on-outside-click/Escape shape as UserMenu -- there is still no anchored-popover
  // primitive in the codebase (Modal.jsx is a full-screen scrim, deliberately).
  useEffect(() => {
    if (!open) return;
    function handleClick(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) setOpen(false);
    }
    function handleKey(e) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open]);

  // Nudge the panel back on screen if anchoring it to the button put it off the edge.
  //
  // Anchoring alone is not enough and no CSS clamp fixes it: WeeklyMetricChart's header WRAPS on a
  // phone, so the "?" lands mid-row instead of at the card's right edge, and a 300px panel hung
  // off its right edge started ~45px off the left of a 390px screen with its first characters
  // clipped. Where the trigger ends up depends on the header's wrap point, which varies with the
  // viewport, the orientation and the metric's label -- so the offset has to be measured, not
  // predicted. Measuring costs one layout read per open, on a panel that just mounted.
  useLayoutEffect(() => {
    if (!open) {
      setShiftX(0);
      return;
    }
    const rect = panelRef.current?.getBoundingClientRect();
    // jsdom computes no layout, so every rect is 0x0 there -- leave it alone rather than
    // "correcting" a panel whose real position is unknown.
    if (!rect || rect.width === 0) return;

    const overflowLeft = VIEWPORT_MARGIN - rect.left;
    const overflowRight = rect.right - (window.innerWidth - VIEWPORT_MARGIN);
    if (overflowLeft > 0) setShiftX(overflowLeft);
    else if (overflowRight > 0) setShiftX(-overflowRight);
    else setShiftX(0);
  }, [open, help]);

  return (
    <div ref={containerRef} style={{ position: 'relative', display: 'inline-flex' }}>
      <IconButton
        icon={IconHelp}
        label={help.label}
        size={16}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        // The 40px .icon-btn box is right for a row of set controls but too heavy beside a 13px
        // chart heading, so this one shrinks. 32px is below the 44px target the rules ask for,
        // which is acceptable only because nothing is lost by missing it: the worst case is the
        // panel not opening, and there is no adjacent control to hit by mistake.
        style={{ width: 32, height: 32, marginLeft: -4 }}
      />

      {open && (
        <div
          ref={panelRef}
          role="note"
          style={{
            position: 'absolute',
            top: '100%',
            // Right-anchored, then clamped to the viewport by the effect above. Anchoring right
            // is the better starting point: the trigger always sits at or near the right of its
            // header, so this needs no correction at all on a tablet or a wide phone.
            right: 0,
            transform: shiftX ? `translateX(${shiftX}px)` : undefined,
            marginTop: 'var(--space-1)',
            width: 'min(300px, calc(100vw - 3rem))',
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-md)',
            boxShadow: 'var(--shadow-2), var(--elevation-hairline)',
            padding: 'var(--space-3)',
            // Beats .recharts-wrapper, which sets position: relative and comes LATER in the DOM,
            // so without this the chart paints over the panel. Deliberately far below
            // --z-app-chrome (10): this scrolls with the tab and must pass under the sticky chrome.
            zIndex: 1,
            textAlign: 'left',
            whiteSpace: 'normal',
          }}
        >
          <div style={{ fontSize: 'var(--text-sm)', fontWeight: 700, color: 'var(--color-text)', marginBottom: 'var(--space-2)' }}>
            {help.title}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            {help.lines.map((line) => (
              <p key={line} style={{ margin: 0, fontSize: 'var(--text-xs)', lineHeight: 1.5, color: 'var(--color-muted)' }}>
                {line}
              </p>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
