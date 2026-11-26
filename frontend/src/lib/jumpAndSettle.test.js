import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JUMP_MAX_FRAMES, JUMP_STILL_FRAMES, jumpAndSettle } from './jumpAndSettle';

// A browser without scroll anchoring (Safari), simulated: the target sits at `aim` right after each
// scrollIntoView, and blocks drawing around it move it by the next drift in `drifts` before the next
// frame reads it. The real case, in WebKit on a five-year History: 301px off after one correction.
function target(drifts) {
  const aim = 132;
  let top = 0;
  const el = {
    scrollIntoView: vi.fn(() => {
      top = aim;
    }),
    getBoundingClientRect: () => ({ top }),
  };
  const frame = () => {
    top += drifts.shift() ?? 0;
  };
  return { el, frame, aim, top: () => top };
}

describe('jumpAndSettle', () => {
  let frames;
  beforeEach(() => {
    frames = [];
    vi.stubGlobal('requestAnimationFrame', (cb) => frames.push(cb) && frames.length);
    vi.stubGlobal('cancelAnimationFrame', () => {
      frames.length = 0;
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  // Frames keep coming whether or not the jump still wants one: blocks go on drawing after it stops.
  const runFrames = (t, n = 100) => {
    for (let i = 0; i < n; i += 1) {
      t.frame();
      if (frames.length) frames.shift()();
    }
  };

  it('re-aims until the target holds still, and lands where the jump aimed', () => {
    const t = target([300, -120, 40]);
    jumpAndSettle(t.el);
    runFrames(t);

    expect(t.top()).toBe(t.aim);
    expect(frames).toHaveLength(0);
    // The jump, one re-aim per drift, then still frames only.
    expect(t.el.scrollIntoView).toHaveBeenCalledTimes(1 + 3 + (JUMP_STILL_FRAMES - 1));
  });

  it('is done after a few still frames when nothing moves (Chrome, which anchors)', () => {
    const t = target([]);
    jumpAndSettle(t.el);
    runFrames(t);

    expect(t.el.scrollIntoView).toHaveBeenCalledTimes(JUMP_STILL_FRAMES);
  });

  it('gives up after its frame budget if the page never settles', () => {
    const t = target(Array(1000).fill(10));
    jumpAndSettle(t.el);
    runFrames(t);

    expect(t.el.scrollIntoView).toHaveBeenCalledTimes(JUMP_MAX_FRAMES);
  });

  // The person scrolling, tapping or typing owns the page from then on.
  it.each(['wheel', 'touchstart', 'keydown', 'mousedown'])('stops the moment the person acts (%s)', (type) => {
    const t = target(Array(1000).fill(10));
    jumpAndSettle(t.el);
    runFrames(t, 2);
    window.dispatchEvent(new Event(type));
    runFrames(t);

    expect(t.el.scrollIntoView).toHaveBeenCalledTimes(3);
  });

  it('can be cancelled', () => {
    const t = target(Array(1000).fill(10));
    const cancel = jumpAndSettle(t.el);
    cancel();
    runFrames(t);

    expect(t.el.scrollIntoView).toHaveBeenCalledTimes(1);
  });
});
