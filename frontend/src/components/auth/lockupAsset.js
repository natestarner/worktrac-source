import lockupSource from '../../assets/huddle-lockup-vertical-onlight.svg?raw';

// The vertical lockup asset, parsed once: its cropped viewBox, the mark group's transform and
// circles, and the wordmark's paths. AnimatedLockup draws from this so its box is exactly the
// static <img> lockup's, and AnimatedLockup.test.jsx pins huddleMarkGeometry to the circles here.
// The onlight file is read for GEOMETRY only -- its colours are not used.

let lockup = null;

export function readLockup() {
  if (lockup) return lockup;
  const root = new DOMParser().parseFromString(lockupSource, 'image/svg+xml').documentElement;
  const [markGroup, wordGroup] = root.querySelectorAll(':scope > g');
  const viewBox = root.getAttribute('viewBox');
  const [, , width, height] = viewBox.split(/\s+/).map(Number);
  lockup = {
    viewBox,
    width,
    height,
    markTransform: markGroup.getAttribute('transform'),
    circles: [...markGroup.querySelectorAll(':scope > circle:not([fill="none"])')].map((c) => ({
      cx: Number(c.getAttribute('cx')),
      cy: Number(c.getAttribute('cy')),
      r: Number(c.getAttribute('r')),
      fill: c.getAttribute('fill'),
    })),
    wordTransform: wordGroup.getAttribute('transform'),
    wordPaths: [...wordGroup.querySelectorAll('path')].map((p) => ({
      transform: p.getAttribute('transform'),
      d: p.getAttribute('d'),
    })),
  };
  return lockup;
}
