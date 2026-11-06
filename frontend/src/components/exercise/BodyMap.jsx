import { useEffect, useRef, useSyncExternalStore } from 'react';
import { MuscleMap } from 'js-rich-body-highlighter';
import { REGISTRY, DRAWN, bodySrc, clipToBody } from './bodyMapArt';

// One body (front or back) with an exercise's muscles shaded: primary at full strength, secondary
// at roughly half. Or, given `levels` ({ code: intensity 0-100 }), each muscle at its own strength
// -- the Trends muscle map, where the shade is how much that muscle was worked. A thin React shell around js-rich-body-highlighter's imperative MuscleMap --
// created once per mount, updated in place when the props change, destroyed on unmount.
//
// Imported eagerly, like everything else in this app (App.jsx: a chunk that has to be fetched is a
// worse failure shape with no signal than one that is already there). The body images are build
// assets: precached on the web (vite.config.js's globPatterns include webp for this) and on the
// device in the App Store app, so the diagram works offline exactly as it does online -- there is
// no network branch.

const PRIMARY_INTENSITY = 80;
const SECONDARY_INTENSITY = 35;

const darkQuery = typeof window !== 'undefined' && window.matchMedia
  ? window.matchMedia('(prefers-color-scheme: dark)')
  : null;

function subscribeTheme(onChange) {
  darkQuery?.addEventListener?.('change', onChange);
  return () => darkQuery?.removeEventListener?.('change', onChange);
}

const themeSnapshot = () => (darkQuery?.matches ? 'dark' : 'light');

// The library sets the tint as an SVG attribute, which cannot read a CSS variable, so the token is
// resolved here. --color-muscle is defined per theme in index.css.
function muscleColor() {
  const value = getComputedStyle(document.documentElement).getPropertyValue('--color-muscle').trim();
  return value || 'red';
}

function highlightsFor(primary, secondary, levels) {
  const color = muscleColor();
  if (levels) {
    return Object.entries(levels)
      .filter(([code, intensity]) => DRAWN.has(code) && intensity > 0)
      .map(([group, intensity]) => ({ group, intensity, color }));
  }
  return [
    ...secondary.filter((code) => DRAWN.has(code)).map((group) => ({ group, intensity: SECONDARY_INTENSITY, color })),
    ...primary.filter((code) => DRAWN.has(code)).map((group) => ({ group, intensity: PRIMARY_INTENSITY, color })),
  ];
}

export default function BodyMap({ primary = [], secondary = [], levels = null, gender = 'male', view = 'front', label, className }) {
  const hostRef = useRef(null);
  const mapRef = useRef(null);
  const theme = useSyncExternalStore(subscribeTheme, themeSnapshot, () => 'light');

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;
    const map = new MuscleMap(host, {
      view,
      gender,
      theme,
      width: '100%',
      registry: REGISTRY,
      hoverHighlight: false,
      bodySrc: bodySrc(gender, view, theme),
      highlights: highlightsFor(primary, secondary, levels),
    });
    mapRef.current = map;
    clipToBody(map.element, gender, bodySrc(gender, view, theme));
    return () => {
      map.destroy();
      mapRef.current = null;
    };
    // Created once per mount; every later prop change goes through update() below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const primaryKey = primary.join(',');
  const secondaryKey = secondary.join(',');
  const levelsKey = levels ? JSON.stringify(levels) : '';
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const src = bodySrc(gender, view, theme);
    map.update({ view, gender, theme, bodySrc: src, highlights: highlightsFor(primary, secondary, levels) });
    clipToBody(map.element, gender, src);
    // The keys stand in for the arrays and the levels object, whose identity changes every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, gender, theme, primaryKey, secondaryKey, levelsKey]);

  return (
    <div
      ref={hostRef}
      className={['body-map', className].filter(Boolean).join(' ')}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : 'true'}
    />
  );
}
