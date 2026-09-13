import { useCallback, useEffect, useState } from 'react';

// Answers two questions about a `.picker-chip-wrap--clipped` container: is anything being cut
// off, and which child is the first one past the cut.
//
// The CLIP ITSELF IS PURE CSS and this hook is not what draws it -- see
// .picker-chip-wrap--clipped in index.css. That split is deliberate. Bounding the list by
// measuring first and rendering second would mean a frame of the wrong height on every mount of
// the app's most-used screen; letting CSS cap the height means the very first paint is already
// correct at any viewport width, and this hook only adds the two things CSS cannot express.
//
// Those two things are worth the effort because clipped-but-present DOM is a real hazard, not a
// cosmetic one: a chip scrolled out of a clipped box is still focusable, still in the
// accessibility tree, and still passes Playwright's toBeVisible(). `inert` on the overflow (the
// caller's job, using firstHiddenIndex) is what makes "hidden" mean hidden to a keyboard and a
// screen reader too.
//
// It deliberately does NOT slice the list down to what fits. Removing the overflow from the DOM
// would shrink the container below its own cap, which fires the observer again, which reports no
// overflow, which restores the list -- an oscillation. Marking the overflow inert leaves layout
// untouched, so the measurement is stable.
//
// Degrades to "measured nothing": jsdom lays nothing out and defines no ResizeObserver, so both
// return values stay at their unmeasured defaults. The caller then renders every chip and CSS
// still clips correctly -- the cost is only that the "Show all" control may be offered when it
// isn't needed, never a broken list.
export function useChipRowOverflow(ref, enabled, itemCount) {
  const [state, setState] = useState(UNMEASURED);

  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    if (!enabled) {
      setState(UNMEASURED);
      return;
    }
    // A 1px tolerance: clientHeight is rounded to an integer while the calc() behind max-height
    // is not, so an exactly-full box can report a scrollHeight one pixel taller than itself.
    const overflowing = el.scrollHeight > el.clientHeight + 1;
    let firstHiddenIndex = -1;
    if (overflowing) {
      const limit = el.getBoundingClientRect().top + el.clientHeight;
      const children = el.children;
      for (let i = 0; i < children.length; i += 1) {
        // The first chip whose TOP is at or past the cut starts the hidden run. Comparing tops
        // rather than bottoms is what keeps this row-aligned: every chip in a given row shares a
        // top, so a row is either wholly in or wholly out.
        if (children[i].getBoundingClientRect().top >= limit) {
          firstHiddenIndex = i;
          break;
        }
      }
    }
    setState((prev) =>
      prev.overflowing === overflowing && prev.firstHiddenIndex === firstHiddenIndex
        ? prev
        : { overflowing, firstHiddenIndex },
    );
  }, [ref, enabled]);

  // itemCount is in the deps because a ResizeObserver alone cannot see this change: while the
  // list is clipped its border box is PINNED at the cap, so adding or removing chips resizes
  // nothing and the observer never fires. Without it, favoriting an exercise (which moves a chip
  // between the two groups) would leave both groups' "Show all" answers stale.
  useEffect(() => {
    measure();
    const el = ref.current;
    // Matches ProductTour's guard -- jsdom has no ResizeObserver, and this must not be the thing
    // that throws on the picker.
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, measure, itemCount]);

  return state;
}

// A frozen shared object so the bail-out comparison in `measure` can return `prev` by identity.
const UNMEASURED = Object.freeze({ overflowing: false, firstHiddenIndex: -1 });
