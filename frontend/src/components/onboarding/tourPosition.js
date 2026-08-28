// Pure arithmetic over plain numbers -- ProductTour.jsx measures real DOM rects and hands them
// here; this file never touches the DOM itself. That split exists because jsdom computes NO
// layout at all, so a component test can never exercise placement -- only this module can be unit
// tested for it, and e2e/tests/onboarding-tour.spec.ts is what proves it against a real browser at
// the three layouts described in the plan.

// Gap kept between the spotlight's hole and the card, same idea as ChartHelp's own gap.
export const TOUR_GAP = 12;
// Gap kept between the card and the edge of the (usable) viewport when it has to be nudged back
// on -- identical value to ChartHelp.jsx's own VIEWPORT_MARGIN.
export const VIEWPORT_MARGIN = 8;
// How far the spotlight's hole extends past the target's own box on every side.
export const SPOTLIGHT_PADDING = 8;

function clamp(value, min, max) {
  // A degenerate range (min > max -- the viewport is smaller than what needs to fit in it) still
  // has to return something rather than an inverted result. Preferring `min` keeps the card off
  // the top/left edge rather than the bottom/right one, which for the vertical axis means never
  // sliding it under the sticky chrome even when there is nowhere good left to put it.
  if (min > max) return min;
  return Math.min(Math.max(value, min), max);
}

function inflate(rect, padding) {
  return {
    top: rect.top - padding,
    left: rect.left - padding,
    width: rect.width + padding * 2,
    height: rect.height + padding * 2,
  };
}

// The last-resort placement: no target at all (the anchor never appeared within the wait), or a
// target none of below/above/side had room for. Centred within the USABLE viewport -- the strip
// between topInset and bottomInset -- never the raw window, so it can't land under the chrome.
function centeredCardPosition(card, viewport, topInset, bottomInset) {
  const usableTop = topInset;
  const usableBottom = viewport.height - bottomInset;
  const top = clamp(
    usableTop + (usableBottom - usableTop - card.height) / 2,
    usableTop + VIEWPORT_MARGIN,
    usableBottom - card.height - VIEWPORT_MARGIN,
  );
  const left = clamp((viewport.width - card.width) / 2, VIEWPORT_MARGIN, viewport.width - card.width - VIEWPORT_MARGIN);
  return { top, left };
}

// `target`/`viewport` are plain `{ top, left, width, height }` rects (as from
// getBoundingClientRect, but never the DOMRect object itself -- see useTourAnchor.js). `target` is
// `null` for the missing-anchor degrade. `card` is `{ width, height }`, measured off the card on
// its first (hidden) render pass.
//
// Resolves in order below -> above -> side (whichever of left/right has more room) -> centred, per
// the layout section of the plan. The centred fallback here still carries a real `spotlight` (a
// genuine hole is cut, just with the card unable to sit beside it) -- that is what makes it
// distinguishable from the missing-anchor degrade below, which has no hole at all.
export function computeTourFrame({ target, card, viewport, topInset = 0, bottomInset = 0 }) {
  const safeCard = card ?? { width: 0, height: 0 };
  const safeViewport = viewport ?? { width: 0, height: 0 };

  if (!target) {
    return { spotlight: null, card: centeredCardPosition(safeCard, safeViewport, topInset, bottomInset), placement: 'centered' };
  }

  const spotlight = inflate(target, SPOTLIGHT_PADDING);
  const usableTop = topInset;
  const usableBottom = safeViewport.height - bottomInset;

  // Horizontal placement for below/above: centred under/over the target, then clamped into the
  // viewport -- the clamp only actually bites for steps 1 and 9 on a phone, where the anchor sits
  // near an edge.
  const targetCenterX = target.left + target.width / 2;
  const horizontalLeft = clamp(
    targetCenterX - safeCard.width / 2,
    VIEWPORT_MARGIN,
    safeViewport.width - safeCard.width - VIEWPORT_MARGIN,
  );

  // Clamped against usableTop/usableBottom, not derived purely from the spotlight's own edges --
  // step 2 anchors the WHOLE person bar (see tourSteps.js), which for a one-person household
  // renders ABOVE .app-chrome instead of inside it (frontend-core.md's sticky-chrome rule), so the
  // sticky chrome itself sits BELOW that anchor rather than above it. A naive
  // "spotlight.bottom + GAP" placement landed the card straight on top of that chrome, because
  // nothing checked whether the space immediately below the spotlight was itself reserved.
  // Re-deriving "does it fit" from the CLAMPED starting point (not the raw spotlight edge) is what
  // makes this correct in both the ordinary case (clamp is a no-op) and this one.
  const belowTop = Math.max(spotlight.top + spotlight.height + TOUR_GAP, usableTop);
  if (belowTop + safeCard.height <= usableBottom) {
    return {
      spotlight,
      card: { top: belowTop, left: horizontalLeft },
      placement: 'below',
    };
  }

  const aboveBottom = Math.min(spotlight.top - TOUR_GAP, usableBottom);
  const aboveTop = aboveBottom - safeCard.height;
  if (aboveTop >= usableTop) {
    return {
      spotlight,
      card: { top: aboveTop, left: horizontalLeft },
      placement: 'above',
    };
  }

  // Neither above nor below fits -- the short-landscape-phone case, with a 44px session bar and a
  // two-column stepper layout leaving no vertical room at all. Try whichever side has more of it.
  const spaceRight = safeViewport.width - (spotlight.left + spotlight.width);
  const spaceLeft = spotlight.left;
  const useRight = spaceRight >= spaceLeft;
  const sideSpace = useRight ? spaceRight : spaceLeft;

  if (sideSpace >= safeCard.width + TOUR_GAP) {
    const verticalCenter = clamp(
      spotlight.top + spotlight.height / 2 - safeCard.height / 2,
      usableTop + VIEWPORT_MARGIN,
      usableBottom - safeCard.height - VIEWPORT_MARGIN,
    );
    return {
      spotlight,
      card: {
        top: verticalCenter,
        left: useRight ? spotlight.left + spotlight.width + TOUR_GAP : spotlight.left - TOUR_GAP - safeCard.width,
      },
      placement: 'side',
    };
  }

  return { spotlight, card: centeredCardPosition(safeCard, safeViewport, topInset, bottomInset), placement: 'centered' };
}
