import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import AnimatedLockup from './AnimatedLockup';
import { readLockup } from './lockupAsset';
import { MARK_CIRCLES } from '../shared/huddleMarkGeometry';

function mockReducedMotion(reduced) {
  window.matchMedia = vi.fn().mockReturnValue({ matches: reduced });
}

// The resting place of each circle, as the rendered <circle> nodes report it, in paint order.
function circlePositions(container) {
  return [...container.querySelectorAll('circle:not([fill="none"])')]
    .filter((c) => !c.closest('mask'))
    .map((c) => ({ cx: Number(c.getAttribute('cx')), cy: Number(c.getAttribute('cy')) }));
}

const RESTING =MARK_CIRCLES.map(({ cx, cy }) => ({ cx, cy }));

afterEach(() => {
  delete window.matchMedia;
  vi.restoreAllMocks();
});

describe('AnimatedLockup', () => {
  it('draws the mark from the same circles as the lockup asset', () => {
    // huddleMarkGeometry is the one copy every drawing of the mark reads. If the asset is
    // re-exported with a circle moved, this is what notices.
    expect(readLockup().circles).toEqual(
      MARK_CIRCLES.map(({ cx, cy, r, fill }) => ({ cx, cy, r, fill })),
    );
  });

  it('is announced as the Huddle logo', () => {
    mockReducedMotion(true);
    render(<AnimatedLockup width={216} />);
    expect(screen.getByRole('img', { name: 'Huddle' })).toBeInTheDocument();
  });

  it('keeps the asset’s own proportions at the requested width', () => {
    mockReducedMotion(true);
    render(<AnimatedLockup width={216} />);
    const svg = screen.getByRole('img', { name: 'Huddle' });
    const { width, height, viewBox } = readLockup();
    expect(svg.getAttribute('viewBox')).toBe(viewBox);
    expect(Number(svg.getAttribute('height'))).toBeCloseTo((216 * height) / width, 5);
  });

  it('draws the wordmark in front of the circles, so they pass behind it', () => {
    mockReducedMotion(true);
    const { container } = render(<AnimatedLockup width={216} />);
    const firstCircle = container.querySelector('circle');
    const firstPath = container.querySelector('path');
    expect(firstCircle.compareDocumentPosition(firstPath) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('shows the finished logo, with no animation, when reduced motion is asked for', () => {
    mockReducedMotion(true);
    const raf = vi.spyOn(window, 'requestAnimationFrame');
    const { container } = render(<AnimatedLockup width={216} />);
    expect(raf).not.toHaveBeenCalled();
    expect(circlePositions(container)).toEqual(RESTING);
  });

  it('starts with the circles away from the huddle, and plays', () => {
    mockReducedMotion(false);
    const raf = vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(1);
    const { container } = render(<AnimatedLockup width={216} />);
    expect(raf).toHaveBeenCalled();
    const positions = circlePositions(container);
    positions.forEach((p, i) => {
      expect(Math.hypot(p.cx - RESTING[i].cx, p.cy - RESTING[i].cy)).toBeGreaterThan(50);
    });
  });

  it('lands every circle exactly in place when it finishes', () => {
    mockReducedMotion(false);
    let frame;
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      frame = cb;
      return 1;
    });
    const { container } = render(<AnimatedLockup width={216} />);
    frame(0); // the clock starts here
    frame(10_000); // long past the end
    expect(circlePositions(container)).toEqual(RESTING);
  });
});
