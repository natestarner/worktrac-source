import { useId, useLayoutEffect, useRef } from 'react';
import { MARK_CIRCLES } from '../shared/huddleMarkGeometry';
import { readLockup } from './lockupAsset';

// The vertical Huddle lockup, with the mark's four circles walking in to form the huddle above a
// wordmark that is there from the first frame. Used on the login screen only.
//
// The wordmark is static on purpose. Someone whose password manager fills the form is gone in a
// second or two; a wordmark that faded in at the end of the walk-in was a name most people never
// saw, and an empty logo slot reads as "still loading" on a backend that is genuinely slow to wake
// (lower's ~35s cold start). The circles are the flourish; the name is never late.
//
// Everything that decides the SIZE comes from the asset file itself -- its cropped viewBox, the
// mark group's transform, the wordmark's paths -- parsed out of the same SVG the <img> lockups use.
// So this renders the exact box the static lockup did (e2e/tests/brand-lockup-size.spec.ts measures
// it), and a future re-crop of the asset moves both together. The circles come from
// huddleMarkGeometry, which AnimatedLockup.test.jsx pins to that same file.
//
// The circles are drawn BEFORE the wordmark, so the two that walk in from below pass behind it.
// The SVG overflows its box while they are in flight and ignores the pointer, so a tap on the form
// beneath is never eaten by a circle mid-walk.
//
// Motion is driven by requestAnimationFrame writing attributes straight onto the nodes -- no React
// re-render per frame. The first render is the FINISHED logo: with reduced motion, no rAF, or a
// throw in the effect, that is what stays on screen. The layout effect rewinds to frame 0 before
// the browser paints, so nobody sees the finished logo flash first.
//
// Choreography is ported from logo/v3/logo/animated/huddle-logo.js (the brand kit's standalone
// animation), played SPEED times faster, with the kit's fade-in wordmark dropped. It ends when the
// last circle plants; the circles' own shoulder shuffle is the only settle.

const SPEED = 1.4;
// Centre of the huddle, in the mark's own space -- the point each circle walks towards.
const HX = 60.5;
const HY = 53.5;
const BOB_HZ = 1.55;
const BOB = 0.9;
// Per circle: where it starts relative to its resting place, when it walks (choreography seconds),
// which way its path bows, and how far shy of the gap it pauses before its last step in.
const MOTION = {
  orange: { dx: -150, dy: -80, t0: 0, t1: 1.85, arc: 1, standoff: 9 },
  rust: { dx: 150, dy: 120, t0: 0.18, t1: 2.1, arc: -1, standoff: 7 },
  amber: { dx: 155, dy: -126, t0: 0.36, t1: 2.4, arc: 1, standoff: 8 },
  cream: { dx: -156, dy: 140, t0: 0.54, t1: 2.65, arc: -1, standoff: 7.5 },
};
const SETTLE_IN = 0.9; // the last steps inward after each walk
// The last circle to plant finishes its steps in: 3.55 choreography seconds -> ~2.5s on screen.
const END = Math.max(...Object.values(MOTION).map((m) => m.t1)) + SETTLE_IN;

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const easeInOutQuart = (t) => (t < 0.5 ? 8 * t ** 4 : 1 - (-2 * t + 2) ** 4 / 2);
const easeOutCubic = (t) => 1 - (1 - t) ** 3;
const easeInOutQuad = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

function circleAt({ cx, cy, r }, m, t) {
  const p = clamp((t - m.t0) / (m.t1 - m.t0), 0, 1);
  const e = easeInOutQuart(p);

  // Stop a few units shy of the gap, then take the last steps inward.
  const ux = cx - HX;
  const uy = cy - HY;
  const ul = Math.hypot(ux, uy) || 1;
  const sx = cx + (ux / ul) * m.standoff;
  const sy = cy + (uy / ul) * m.standoff;
  const q = clamp((t - m.t1) / SETTLE_IN, 0, 1);
  const qe = easeOutCubic(q);
  let x = sx + (cx - sx) * qe + m.dx * (1 - e);
  let y = sy + (cy - sy) * qe + m.dy * (1 - e);

  // A curved approach.
  const tl = Math.hypot(m.dx, m.dy) || 1;
  const arc = Math.sin(Math.PI * p) * 17 * m.arc;
  x += (-m.dy / tl) * arc;
  y += (m.dx / tl) * arc;

  // A shoulder shuffle while settling, damped to zero.
  const sh = Math.sin(q * Math.PI * 2.6) * 1.6 * (1 - q) * m.arc;
  x += (-uy / ul) * sh;
  y += (ux / ul) * sh;

  // A walking bob, gone once planted.
  const walking = 1 - p ** 2.4;
  y -= Math.abs(Math.sin((t - m.t0) * BOB_HZ * Math.PI * 2)) * r * 0.16 * BOB * walking;

  return {
    x,
    y,
    r: r * (0.84 + 0.16 * e),
    opacity: easeInOutQuad(clamp((t - m.t0) / 0.25, 0, 1)),
  };
}

export default function AnimatedLockup({ width, style }) {
  const { viewBox, width: vbWidth, height: vbHeight, markTransform, wordTransform, wordPaths } =
    readLockup();
  // useId's output carries characters a url(#…) reference can trip on.
  const maskId = `huddle-lockup-hairline-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const circleRefs = useRef({});
  const hairlineRef = useRef(null);
  const maskCircleRef = useRef(null);
  const orange = MARK_CIRCLES.find((c) => c.id === 'orange');

  useLayoutEffect(() => {
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduced || typeof requestAnimationFrame !== 'function') return undefined;

    const set = (node, attrs) => {
      if (!node) return;
      for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    };

    function render(t) {
      for (const circle of MARK_CIRCLES) {
        const s = circleAt(circle, MOTION[circle.id], t);
        const pos = { cx: s.x.toFixed(2), cy: s.y.toFixed(2), r: s.r.toFixed(2) };
        set(circleRefs.current[circle.id], { ...pos, opacity: s.opacity.toFixed(3) });
        // The orange disc masks the cream circle's hairline where the two meet, as in the asset.
        if (circle.id === 'orange') set(maskCircleRef.current, pos);
        if (circle.id === 'cream') set(hairlineRef.current, { ...pos, opacity: s.opacity.toFixed(3) });
      }
    }

    // Rewind to frame 0 before the first paint, then play. The clock starts on the first frame
    // that actually runs, so a page opened in a background tab plays when it is first seen rather
    // than jumping to the end.
    render(0);
    let start = null;
    let raf = requestAnimationFrame(function frame(now) {
      if (start === null) start = now;
      const t = ((now - start) / 1000) * SPEED;
      render(Math.min(t, END));
      raf = t < END ? requestAnimationFrame(frame) : null;
    });
    return () => {
      if (raf) cancelAnimationFrame(raf);
      render(END);
    };
  }, []);

  return (
    <svg
      viewBox={viewBox}
      width={width}
      height={(width * vbHeight) / vbWidth}
      role="img"
      aria-label="Huddle"
      style={{
        aspectRatio: `${vbWidth} / ${vbHeight}`,
        overflow: 'visible',
        pointerEvents: 'none',
        ...style,
      }}
    >
      <g transform={markTransform}>
        <defs>
          {/* Generous bounds: the hairline must stay visible while the cream circle is in flight
              far outside the mark's resting box. */}
          <mask id={maskId} maskUnits="userSpaceOnUse" x="-400" y="-400" width="900" height="900">
            <rect x="-400" y="-400" width="900" height="900" fill="#FFFFFF" />
            <circle
              ref={maskCircleRef}
              cx={orange.cx}
              cy={orange.cy}
              r={orange.r}
              fill="#000000"
            />
          </mask>
        </defs>
        {MARK_CIRCLES.map(({ id, cx, cy, r, fill }) => (
          <g key={id}>
            <circle
              ref={(node) => {
                circleRefs.current[id] = node;
              }}
              cx={cx}
              cy={cy}
              r={r}
              fill={fill}
            />
            {id === 'cream' && (
              <circle
                ref={hairlineRef}
                cx={cx}
                cy={cy}
                r={r}
                fill="none"
                strokeWidth="1.5"
                mask={`url(#${maskId})`}
                style={{ stroke: 'var(--brand-mark-hairline)' }}
              />
            )}
          </g>
        ))}
      </g>
      <g
        transform={wordTransform}
        strokeWidth="1.02"
        strokeLinejoin="round"
        paintOrder="stroke"
        style={{ fill: 'var(--brand-wordmark-ink)', stroke: 'var(--brand-wordmark-ink)' }}
      >
        {wordPaths.map(({ transform, d }) => (
          <path key={transform} transform={transform} d={d} />
        ))}
      </g>
    </svg>
  );
}
