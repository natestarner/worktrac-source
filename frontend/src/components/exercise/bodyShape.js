// The female body's shape. The library's female figure is the male figure's proportions with a
// different surface (shoulders much wider than the hips, a straight torso), so the body images are
// reshaped: shoulders a little narrower, the waist drawn in, the hips fuller, the thighs a little
// slimmer and the legs brought in under her (the library's stand well apart). The reshape is a
// smooth, purely horizontal shift of every row, applied once to the images at build time
// (design-mockups/muscle-map-shaded-v2/build-tools/faces.js imports this file) and to the muscle
// outlines here at runtime, so a highlight still lands on its muscle. Change a number here and
// the images must be rebuilt, or the two drift apart.
//
// Coordinates are body-image pixels (1365 x 2048), the library's viewBox / PX2MM.

const PX2MM = 25.4 / 96;

// cx: the body's centre line. scale: the whole row (arms included) is scaled toward the centre,
// ramping in over the shoulders and back out by the hips -- that narrows the shoulders and the
// waist together and swings the arms in with them. waist / hips: an extra pull in or push out on
// the torso alone, fading to nothing before the arms beside it (inner..outer, in px from centre).
// thighs: each thigh narrowed about its own centre line (`centre` px from the body's) by `k`, in
//   from..full and out again over hold..back; `split` px either side of the centre line ease it in,
//   so the join at the crotch stretches rather than tears.
// stance: each leg moved toward the centre without changing its width, by nothing at `from` up to
//   `amount` at `to` (the feet), so the legs splay less. Both stop before the hands (`fade`).
const SHAPE = {
  front: {
    cx: 685.5,
    scale: { from: 400, full: 530, hold: 760, back: 1010, min: 0.93 },
    waist: { y: 785, spread: 70, amount: -11, inner: 40, edge: 115, fade: 165 },
    hips: { y: 940, spread: 70, amount: 13, inner: 40, edge: 180, fade: 245 },
    thighs: { centre: 112, k: 0.92, from: 1030, full: 1130, hold: 1330, back: 1520, split: 26 },
    stance: { from: 1150, to: 1880, amount: 24, fade: [235, 275] },
  },
  back: {
    cx: 681,
    scale: { from: 400, full: 530, hold: 760, back: 1010, min: 0.93 },
    waist: { y: 785, spread: 70, amount: -11, inner: 40, edge: 120, fade: 170 },
    hips: { y: 940, spread: 70, amount: 13, inner: 40, edge: 175, fade: 240 },
    thighs: { centre: 108, k: 0.92, from: 1030, full: 1130, hold: 1330, back: 1520, split: 26 },
    stance: { from: 1150, to: 1880, amount: 24, fade: [235, 275] },
  },
};

const smooth = (a, b, v) => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

function rowScale(y, s) {
  if (y <= s.hold) return 1 - (1 - s.min) * smooth(s.from, s.full, y);
  return 1 - (1 - s.min) * (1 - smooth(s.hold, s.back, y));
}

// A torso-only push: zero on the centre line, full at `edge`, gone again by `fade`.
function bulge(u, y, b) {
  const across = smooth(b.inner, b.edge, u) * (1 - smooth(b.edge, b.fade, u));
  const along = Math.exp(-(((y - b.y) / b.spread) ** 2));
  return b.amount * across * along;
}

// The legs' outward shift at distance u from the centre line (negative = toward the centre).
function legs(u, y, p) {
  const t = p.thighs;
  const st = p.stance;
  const beforeHands = 1 - smooth(st.fade[0], st.fade[1], u);
  const thighAlong = y <= t.hold ? smooth(t.from, t.full, y) : 1 - smooth(t.hold, t.back, y);
  const thigh = -(1 - t.k) * (u - t.centre) * smooth(0, t.split, u) * thighAlong;
  const d = st.amount * smooth(st.from, st.to, y);
  // The ramp across the gap between the legs is wider than 1.5x the shift, so no row can fold.
  const stance = -d * smooth(0, Math.max(10, 1.6 * d), u);
  return (thigh + stance) * beforeHands;
}

// Where the point (x, y) of the original image lands in the reshaped one. Strictly increasing in
// x on every row (the pushes change by far less than a pixel per pixel), so the build can invert it.
export function shapeX(x, y, view) {
  const p = SHAPE[view];
  const dx = x - p.cx;
  const u = Math.abs(dx);
  const sign = dx < 0 ? -1 : 1;
  return p.cx + dx * rowScale(y, p.scale) + sign * (bulge(u, y, p.waist) + bulge(u, y, p.hips) + legs(u, y, p));
}

// An SVG path's `d` (absolute or relative M/L/H/V/C/S/Q/T/Z; the library's outlines use these)
// with every point, control points included, moved by shapeX. Points are in viewBox units and the
// path is drawn under translate(offset px * PX2MM); the result is absolute and drawn under the same
// translate, so clipToBody's mask offsets still line up.
export function reshapePath(d, offset, view) {
  const ox = (offset?.x ?? 0) * PX2MM;
  const oy = (offset?.y ?? 0) * PX2MM;
  const move = (x, y) => {
    const px = (x + ox) / PX2MM;
    const py = (y + oy) / PX2MM;
    return [shapeX(px, py, view) * PX2MM - ox, y];
  };
  const fmt = (n) => String(Math.round(n * 1000) / 1000);
  const tokens = d.match(/[a-zA-Z]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g) || [];
  const out = [];
  let i = 0;
  let cmd = '';
  let x = 0;
  let y = 0;
  let sx = 0;
  let sy = 0;
  const num = () => parseFloat(tokens[i++]);
  while (i < tokens.length) {
    if (/^[a-zA-Z]$/.test(tokens[i])) cmd = tokens[i++]; // not /[a-z]/: numbers like 1e-5 contain an e
    const rel = cmd === cmd.toLowerCase();
    const C = cmd.toUpperCase();
    const pt = () => {
      const a = num();
      const b = num();
      return rel ? [x + a, y + b] : [a, b];
    };
    const put = (letter, pts) => out.push(letter + pts.map(([px, py]) => move(px, py).map(fmt).join(' ')).join(' '));
    if (C === 'Z') {
      out.push('Z');
      x = sx;
      y = sy;
      continue;
    }
    if (C === 'M') {
      [x, y] = pt();
      sx = x;
      sy = y;
      put('M', [[x, y]]);
      cmd = rel ? 'l' : 'L'; // further pairs after a moveto are linetos
    } else if (C === 'L' || C === 'T') {
      [x, y] = pt();
      put(C, [[x, y]]);
    } else if (C === 'H') {
      const a = num();
      x = rel ? x + a : a;
      put('L', [[x, y]]); // a horizontal line is no longer horizontal once rows shift differently
    } else if (C === 'V') {
      const a = num();
      y = rel ? y + a : a;
      put('L', [[x, y]]);
    } else if (C === 'C') {
      const p1 = pt();
      const p2 = pt();
      const p3 = pt();
      [x, y] = p3;
      put('C', [p1, p2, p3]);
    } else if (C === 'S' || C === 'Q') {
      const p1 = pt();
      const p2 = pt();
      [x, y] = p2;
      put(C, [p1, p2]);
    } else {
      throw new Error(`reshapePath: unsupported path command ${cmd}`);
    }
  }
  return out.join(' ');
}

// The same move for a point given directly in viewBox units (bodyMapArt's TRAP_CUT).
export function reshapePoint([x, y], view) {
  return [shapeX(x / PX2MM, y / PX2MM, view) * PX2MM, y];
}
