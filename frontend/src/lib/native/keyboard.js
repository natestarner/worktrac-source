// Keeps the field being typed into visible above the keyboard, in the app.
//
// @capacitor/keyboard removes WKWebView's own keyboard observers so its resize modes can work, and
// with them goes WebKit's "scroll the focused field into view". capacitor.config.json's
// `Keyboard.resize: "native"` shrinks the WebView to end at the top of the keyboard, which is enough
// for a short screen (the login form re-centres in what is left). A field further down a longer
// page can still sit under the keyboard, or under the SessionBar that now rides on top of it. So
// when the keyboard opens, or focus moves while it is open, a field that is out of view is scrolled
// to the middle of the space that is left. A field already in view is never moved.
//
// Web: no-op. Safari does this itself.
import { isNativeApp } from './platform';

const EDGE_PX = 8;

function coveredAtBottom() {
  // SessionBar publishes its own height here (frontend-core.md, "The bottom chrome").
  const value = getComputedStyle(document.documentElement).getPropertyValue('--bottom-bar-height');
  return parseFloat(value) || 0;
}

function revealFocusedField() {
  const el = document.activeElement;
  if (!el?.matches?.('input, textarea, select, [contenteditable="true"]')) return;
  const rect = el.getBoundingClientRect();
  const visibleBottom = window.innerHeight - coveredAtBottom() - EDGE_PX;
  if (rect.top >= 0 && rect.bottom <= visibleBottom) return;
  el.scrollIntoView({ block: 'center' });
}

// Starts watching. Returns a function that stops.
export function keepFocusedFieldVisible() {
  if (!isNativeApp()) return () => {};

  let stopped = false;
  let handle = null;
  // A frame later, so the WebView's resize has reached layout before anything is measured.
  const reveal = () =>
    requestAnimationFrame(() => {
      if (!stopped) revealFocusedField();
    });

  // Moving to another field with the keyboard already up fires no keyboard event.
  document.addEventListener('focusin', reveal);

  (async () => {
    try {
      const { Keyboard } = await import('@capacitor/keyboard');
      if (stopped) return;
      const listener = await Keyboard.addListener('keyboardDidShow', reveal);
      if (stopped) listener.remove();
      else handle = listener;
    } catch {
      // The plugin failed to load. The WebView still shrinks above the keyboard, which keeps
      // short screens usable; only the extra scroll on a long page is lost.
    }
  })();

  return () => {
    stopped = true;
    document.removeEventListener('focusin', reveal);
    handle?.remove();
  };
}
