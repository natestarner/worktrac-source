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
// A field inside a dialog is revealed inside the dialog's own panel, and a field on the page is kept
// clear of the sticky tab bar as well as the keyboard and the SessionBar. That logic is shared with
// the web (lib/visibleViewport.js) so the two cannot drift; this file only decides WHEN, since the
// keyboard events it listens for exist only in the app.
//
// Web: no-op. Safari does this itself.
import { isNativeApp } from './platform';
import { revealFocusedField } from '../visibleViewport';

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
