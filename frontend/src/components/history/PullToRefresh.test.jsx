import { useRef } from 'react';
import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import PullToRefresh, { PULL_THRESHOLD_PX, isInstalledApp } from './PullToRefresh';

function Harness({ onRefresh, enabled = true }) {
  const ref = useRef(null);
  return (
    <div ref={ref} data-testid="tab">
      <PullToRefresh targetRef={ref} onRefresh={onRefresh} enabled={enabled} />
    </div>
  );
}

const touch = (x, y) => ({ clientX: x, clientY: y });

function fire(el, type, points) {
  const event = new Event(type, { bubbles: true });
  event.touches = points;
  act(() => {
    el.dispatchEvent(event);
  });
}

// A finger down at (x, y0), moved to (x + dx, y0 + dy) in a few steps, then lifted.
function drag(el, { dx = 0, dy }) {
  fire(el, 'touchstart', [touch(100, 100)]);
  for (let i = 1; i <= 4; i += 1) fire(el, 'touchmove', [touch(100 + (dx * i) / 4, 100 + (dy * i) / 4)]);
}

describe('PullToRefresh', () => {
  afterEach(() => {
    window.scrollY = 0;
  });

  it('refreshes when a pull down from the top passes the threshold and is let go', () => {
    const onRefresh = vi.fn();
    render(<Harness onRefresh={onRefresh} />);
    const tab = screen.getByTestId('tab');

    drag(tab, { dy: PULL_THRESHOLD_PX + 20 });
    expect(screen.getByText('Release to refresh History')).toBeTruthy();
    fire(tab, 'touchend', []);

    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/to refresh History/)).toBeNull();
  });

  it('does nothing for a pull let go short of the threshold', () => {
    const onRefresh = vi.fn();
    render(<Harness onRefresh={onRefresh} />);
    const tab = screen.getByTestId('tab');

    drag(tab, { dy: PULL_THRESHOLD_PX - 20 });
    expect(screen.getByText('Pull to refresh History')).toBeTruthy();
    fire(tab, 'touchend', []);

    expect(onRefresh).not.toHaveBeenCalled();
  });

  it('is not a pull when the page is scrolled down', () => {
    const onRefresh = vi.fn();
    render(<Harness onRefresh={onRefresh} />);
    window.scrollY = 300;

    drag(screen.getByTestId('tab'), { dy: PULL_THRESHOLD_PX * 2 });
    fire(screen.getByTestId('tab'), 'touchend', []);

    expect(onRefresh).not.toHaveBeenCalled();
  });

  // The tag chips scroll sideways; a swipe along them that drifts downward is not a pull.
  it('is not a pull when the gesture starts sideways', () => {
    const onRefresh = vi.fn();
    render(<Harness onRefresh={onRefresh} />);

    drag(screen.getByTestId('tab'), { dx: 200, dy: PULL_THRESHOLD_PX + 20 });
    fire(screen.getByTestId('tab'), 'touchend', []);

    expect(onRefresh).not.toHaveBeenCalled();
  });

  it('does nothing when a pull is cancelled', () => {
    const onRefresh = vi.fn();
    render(<Harness onRefresh={onRefresh} />);

    drag(screen.getByTestId('tab'), { dy: PULL_THRESHOLD_PX + 20 });
    fire(screen.getByTestId('tab'), 'touchcancel', []);
    fire(screen.getByTestId('tab'), 'touchend', []);

    expect(onRefresh).not.toHaveBeenCalled();
  });

  // In a browser tab the browser's own pull down reloads the page, and a reload of History already
  // re-downloads it; listening there too would fire twice.
  it('listens only when enabled', () => {
    const onRefresh = vi.fn();
    render(<Harness onRefresh={onRefresh} enabled={false} />);

    drag(screen.getByTestId('tab'), { dy: PULL_THRESHOLD_PX + 20 });
    fire(screen.getByTestId('tab'), 'touchend', []);

    expect(onRefresh).not.toHaveBeenCalled();
  });
});

describe('isInstalledApp', () => {
  const original = window.matchMedia;
  afterEach(() => {
    window.matchMedia = original;
    delete window.navigator.standalone;
  });

  it('is the standalone display mode, or iOS standalone', () => {
    window.matchMedia = vi.fn(() => ({ matches: false }));
    expect(isInstalledApp()).toBe(false);
    window.matchMedia = vi.fn(() => ({ matches: true }));
    expect(isInstalledApp()).toBe(true);
    window.matchMedia = vi.fn(() => ({ matches: false }));
    Object.defineProperty(window.navigator, 'standalone', { value: true, configurable: true });
    expect(isInstalledApp()).toBe(true);
  });
});
