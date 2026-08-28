import { describe, expect, it } from 'vitest';
import { computeTourFrame, SPOTLIGHT_PADDING, VIEWPORT_MARGIN } from './tourPosition';

// jsdom computes no layout at all, so this is the only place any of this can be proven -- see the
// file's own header comment. The three layouts below are the three the app actually has (see the
// plan's layout section / index.css:1283's one shape-changing breakpoint), driven as data rather
// than duplicated per test so every assertion in this file runs against all three where relevant.
const PORTRAIT_PHONE = { viewport: { width: 390, height: 844 }, topInset: 110, bottomInset: 92 };
const LANDSCAPE_PHONE = { viewport: { width: 844, height: 390 }, topInset: 60, bottomInset: 44 };
const DESKTOP = { viewport: { width: 1920, height: 1080 }, topInset: 64, bottomInset: 0 };
const LAYOUTS = [
  ['portrait phone', PORTRAIT_PHONE],
  ['landscape phone', LANDSCAPE_PHONE],
  ['desktop', DESKTOP],
];

const CARD = { width: 320, height: 200 };

describe('computeTourFrame', () => {
  it('places the card below the spotlight when there is room', () => {
    const target = { top: 200, left: 100, width: 200, height: 50 };
    const frame = computeTourFrame({ target, card: CARD, ...DESKTOP });

    expect(frame.placement).toBe('below');
    expect(frame.spotlight).not.toBeNull();
    expect(frame.card.top).toBe(frame.spotlight.top + frame.spotlight.height + 12);
  });

  it('places the card above the spotlight when below has no room', () => {
    // Near the very bottom of the usable band -- not enough room below for a 200px card, plenty
    // above.
    const usableBottom = PORTRAIT_PHONE.viewport.height - PORTRAIT_PHONE.bottomInset;
    const target = { top: usableBottom - 60, left: 40, width: 200, height: 40 };
    const frame = computeTourFrame({ target, card: CARD, ...PORTRAIT_PHONE });

    expect(frame.placement).toBe('above');
    expect(frame.card.top + CARD.height).toBeLessThanOrEqual(frame.spotlight.top);
  });

  // The tightest case in the app: a landscape phone with the 44px session bar, where the anchor
  // sits mid-column in the two-column detail grid and neither above nor below has enough vertical
  // room at all.
  it('places the card beside the spotlight, on the side with more room, when neither above nor below fits', () => {
    const target = { top: 150, left: 50, width: 200, height: 80 };
    const frame = computeTourFrame({ target, card: CARD, ...LANDSCAPE_PHONE });

    expect(frame.placement).toBe('side');
    // More room to the right of a target sitting near the left edge of an 844px-wide viewport.
    expect(frame.card.left).toBeGreaterThan(frame.spotlight.left + frame.spotlight.width);
  });

  it('falls back to a centred card, with the spotlight still cut, when no side fits either', () => {
    const tinyViewport = { width: 300, height: 300 };
    const target = { top: 120, left: 100, width: 40, height: 40 };
    const bigCard = { width: 250, height: 200 };
    const frame = computeTourFrame({ target, card: bigCard, viewport: tinyViewport, topInset: 50, bottomInset: 50 });

    expect(frame.placement).toBe('centered');
    // This is the distinguishing property versus the missing-anchor degrade below: a real hole is
    // still cut, the card just can't sit next to it.
    expect(frame.spotlight).not.toBeNull();
  });

  it('degrades to spotlight: null and a centred card when there is no target at all', () => {
    const frame = computeTourFrame({ target: null, card: CARD, ...DESKTOP });

    expect(frame.spotlight).toBeNull();
    expect(frame.placement).toBe('centered');
    expect(frame.card.top).toBeGreaterThanOrEqual(0);
    expect(frame.card.left).toBeGreaterThanOrEqual(0);
  });

  it('clamps the card left edge to VIEWPORT_MARGIN rather than letting it go negative', () => {
    const target = { top: 300, left: 0, width: 20, height: 20 };
    const frame = computeTourFrame({ target, card: CARD, ...DESKTOP });

    expect(frame.placement).toBe('below');
    expect(frame.card.left).toBe(VIEWPORT_MARGIN);
  });

  it('clamps the card right edge instead of letting it overflow the viewport', () => {
    const target = { top: 300, left: DESKTOP.viewport.width - 20, width: 20, height: 20 };
    const frame = computeTourFrame({ target, card: CARD, ...DESKTOP });

    expect(frame.placement).toBe('below');
    expect(frame.card.left).toBe(DESKTOP.viewport.width - CARD.width - VIEWPORT_MARGIN);
  });

  // Regression: step 2 anchors the WHOLE person bar, which for a one-person household renders
  // ABOVE .app-chrome instead of inside it (frontend-core.md's sticky-chrome rule) -- so the
  // sticky chrome sits BELOW this particular anchor, not above it, unlike every other step. Found
  // live at 1440x900 (laptop): the naive "spotlight.bottom + GAP" placement landed the card
  // straight on top of the tab bar underneath the person bar.
  it('drops the card below the sticky chrome, not on top of it, when the anchor sits above the chrome', () => {
    // A solo household's person bar: y 61-122. The chrome (tab bar only) directly below it: 122-178.
    const target = { top: 61, left: 0, width: 1440, height: 61 };
    const topInset = 178; // .app-chrome's own bottom edge
    const frame = computeTourFrame({ target, card: CARD, viewport: { width: 1440, height: 900 }, topInset, bottomInset: 0 });

    expect(frame.placement).toBe('below');
    expect(frame.card.top).toBeGreaterThanOrEqual(topInset);
  });

  it('inflates the target by SPOTLIGHT_PADDING on every side to produce the spotlight', () => {
    const target = { top: 200, left: 100, width: 200, height: 50 };
    const frame = computeTourFrame({ target, card: CARD, ...DESKTOP });

    expect(frame.spotlight).toEqual({
      top: target.top - SPOTLIGHT_PADDING,
      left: target.left - SPOTLIGHT_PADDING,
      width: target.width + SPOTLIGHT_PADDING * 2,
      height: target.height + SPOTLIGHT_PADDING * 2,
    });
  });

  // The one invariant that must hold across every layout, whatever placement is chosen: the card
  // must never be placed under the sticky chrome or over the bottom bar.
  describe.each(LAYOUTS)('never overlaps topInset or bottomInset — %s', (_, layout) => {
    const usableBottom = layout.viewport.height - layout.bottomInset;
    const positions = [
      { top: layout.topInset + 10, left: 20, width: 120, height: 40 }, // just under the chrome
      { top: (layout.topInset + usableBottom) / 2 - 20, left: 200, width: 160, height: 40 }, // middle
      { top: usableBottom - 50, left: 60, width: 140, height: 40 }, // just above the bottom bar
    ];

    it.each(positions.map((target, i) => [i, target]))('for target position %i', (_i, target) => {
      const frame = computeTourFrame({ target, card: CARD, ...layout });

      expect(frame.card.top).toBeGreaterThanOrEqual(layout.topInset - 0.01);
      expect(frame.card.top + CARD.height).toBeLessThanOrEqual(usableBottom + 0.01);
    });
  });
});
