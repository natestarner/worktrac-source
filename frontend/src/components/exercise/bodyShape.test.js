import { describe, it, expect } from 'vitest';
import { MUSCLES } from 'js-rich-body-highlighter';
import { shapeX, reshapePath, reshapePoint } from './bodyShape';

const PX2MM = 25.4 / 96;

describe('the female reshape', () => {
  // The image build inverts shapeX row by row, which only works if no two points of a row land on
  // the same column: every row must stay strictly increasing.
  it('never folds a row', () => {
    const folds = [];
    for (const view of ['front', 'back']) {
      for (let y = 0; y < 2048; y += 4) {
        let prev = -Infinity;
        for (let x = 0; x <= 1365; x += 0.5) {
          const v = shapeX(x, y, view);
          if (!(v > prev)) folds.push(`${view} row ${y} at x ${x}`);
          prev = v;
        }
      }
    }
    expect(folds).toEqual([]);
  });

  it('leaves the head, the hands and the centre line where they are', () => {
    for (const view of ['front', 'back']) {
      expect(shapeX(600, 200, view)).toBe(600);
      // A hand, beside the thighs: the leg changes stop short of it.
      expect(shapeX(330, 1150, view)).toBeCloseTo(330, 6);
    }
    expect(shapeX(685.5, 800, 'front')).toBeCloseTo(685.5, 6);
  });

  it('draws the waist in and pushes the hips out', () => {
    // A point on the waist edge moves toward the centre line; one on the hip edge moves away.
    expect(shapeX(566, 785, 'front')).toBeGreaterThan(566);
    expect(shapeX(510, 940, 'front')).toBeLessThan(510);
  });

  it('slims the thighs and brings the feet in', () => {
    // Mid-thigh, the outer edge comes in and the inner edge goes out: a narrower thigh.
    const outer = shapeX(482, 1250, 'front');
    const inner = shapeX(649, 1250, 'front');
    expect(outer).toBeGreaterThan(482);
    expect(inner - outer).toBeLessThan(649 - 482);
    // At the ankles each leg moves toward the centre by about the same amount on both edges.
    const a = shapeX(512, 1850, 'front') - 512;
    const b = shapeX(584, 1850, 'front') - 584;
    expect(a).toBeGreaterThan(15);
    expect(Math.abs(a - b)).toBeLessThan(1);
  });
});

describe('reshapePath', () => {
  // Above row 400 nothing moves, so the result is just the path made absolute.
  it('turns relative, H/V and exponent-form numbers into the same absolute points', () => {
    const out = reshapePath('m10 20 l5-1e-1 h3 v2 c1 1 2 2 3 3 s1 1 2 2 z M40 50 L41 51 Z', { x: 0, y: 0 }, 'front');
    expect(out).toBe('M10 20 L15 19.9 L18 19.9 L18 21.9 C19 22.9 20 23.9 21 24.9 S22 25.9 23 26.9 Z M40 50 L41 51 Z');
  });

  it('continues a moveto with implicit linetos', () => {
    expect(reshapePath('M1 2 3 4 5 6', null, 'front')).toBe('M1 2 L3 4 L5 6');
  });

  it('moves points the way shapeX does, in the translated frame', () => {
    const offset = { x: 100, y: 700 };
    const out = reshapePath('M20 10', offset, 'front');
    const px = (20 + offset.x * PX2MM) / PX2MM;
    const py = (10 + offset.y * PX2MM) / PX2MM;
    const want = shapeX(px, py, 'front') * PX2MM - offset.x * PX2MM;
    expect(parseFloat(out.split(' ')[0].slice(1))).toBeCloseTo(want, 2);
  });

  it('handles every female outline in the library', () => {
    for (const m of MUSCLES.filter((x) => x.gender === 'female')) {
      expect(() => reshapePath(m.d, m.offset, m.view), m.id).not.toThrow();
    }
  });

  it('keeps y and moves a point given in viewBox units', () => {
    const [x, y] = reshapePoint([130, 121], 'back');
    expect(y).toBe(121);
    expect(x).toBeCloseTo(shapeX(130 / PX2MM, 121 / PX2MM, 'back') * PX2MM, 6);
  });
});
