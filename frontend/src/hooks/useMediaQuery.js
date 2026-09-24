import { useCallback, useSyncExternalStore } from 'react';

// Whether a CSS media query currently matches, live (rotating an iPad, resizing a window).
//
// For the rare layout decision CSS cannot make on its own -- which PROP a component gets, like
// Modal's `align`. Anything expressible as a stylesheet rule belongs in index.css instead.
//
// jsdom (and any browser old enough) has no matchMedia; that reads as "doesn't match", so a caller
// falls back to whatever it renders by default rather than throwing during render.
export function useMediaQuery(query) {
  const subscribe = useCallback(
    (onChange) => {
      if (typeof window === 'undefined' || !window.matchMedia) return () => {};
      const mql = window.matchMedia(query);
      mql.addEventListener?.('change', onChange);
      return () => mql.removeEventListener?.('change', onChange);
    },
    [query],
  );
  const getSnapshot = () => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(query).matches : false);
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
