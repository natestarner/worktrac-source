// The part of the screen a person can actually see, and keeping the field they are typing into
// inside it. The ONE place the app answers "where is the keyboard?" -- every overlay and every
// "scroll the field into view" goes through here, so they cannot disagree.
//
// Why it is needed: on an iPhone the keyboard does not shrink the page. Safari keeps the layout
// viewport full height and shows only part of it (the VISUAL viewport), panning that part to keep
// the focused field above the keyboard. A `position: fixed; inset: 0` overlay is sized to the
// layout viewport, so a dialog centred in it is partly under the keyboard, and when Safari pans to
// the field the dialog's header and top fields go off the top of the screen. The page behind is
// scroll-locked (lib/bodyScrollLock.js), so there was no way to scroll back to them: the Add
// exercise and New routine dialogs both did this (2026-11-08).
//
// The fix is to size every overlay to the visual viewport, not the layout one. `trackVisibleViewport`
// publishes it on the root element as two custom properties, beside --bottom-bar-height:
//   --visible-viewport-top     how far the visible part starts below the layout viewport's top
//   --visible-viewport-height  how tall the visible part is (the keyboard's top, when it is up)
// Modal.jsx positions its scrim with them, so its panel always fits in what is visible and scrolls
// inside itself. Where `visualViewport` is missing (jsdom, very old browsers) nothing is published
// and every reader falls back to the full viewport, which is exactly the old behaviour.
//
// This is one code path on every platform. In the App Store app the WebView itself shrinks above
// the keyboard (`Keyboard.resize: "native"`), so the visual viewport simply equals the window and
// the properties describe the same box `inset: 0` already did.

const FIELD = 'input, textarea, select, [contenteditable="true"]';
// Breathing room kept between a revealed field and whatever edge it was revealed past, so its
// focus ring (drawn outside the border) is not clipped by that edge.
const EDGE_PX = 12;

function readPx(name) {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name);
  return parseFloat(value) || 0;
}

// The visible band in client coordinates (what getBoundingClientRect reports).
function visibleBand() {
  const vv = window.visualViewport;
  const top = vv ? vv.offsetTop : 0;
  const height = vv ? vv.height : window.innerHeight;
  return { top, bottom: top + height };
}

// Starts publishing. Returns a function that stops. Mounted once, app-wide, by FocusedFieldKeeper.
export function trackVisibleViewport() {
  const vv = window.visualViewport;
  if (!vv) return () => {};
  const root = document.documentElement;
  let frame = 0;
  let lastHeight = null;

  // The window's own height, as a pixel value a full-screen layer is sized with (the Log picker's
  // search). Not `inset: 0` alone: in the App Store app the window shrinks above the keyboard, and
  // WKWebView sometimes left a fixed `inset: 0` layer at its pre-keyboard height -- 956px in a
  // 609px window, measured on the simulator (2026-11-26) -- with the end of the list under the
  // keyboard and, for a short list, nothing to scroll. window.innerHeight was right; only the CSS
  // layout was stale. Changing the value is a style change, which forces the layout. Published at
  // once on a window resize, and again with everything else a frame later.
  const publishWindowHeight = () => root.style.setProperty('--window-height', `${window.innerHeight}px`);

  const publish = () => {
    frame = 0;
    publishWindowHeight();
    root.style.setProperty('--visible-viewport-top', `${vv.offsetTop}px`);
    root.style.setProperty('--visible-viewport-height', `${vv.height}px`);
    // How much of the bottom of the window the keyboard covers. Safari only: in the app the window
    // itself ends at the keyboard, so this is 0. A scroller pinned to the window pads its end by
    // this much, so its last row can be scrolled above the keyboard without the box itself moving
    // (the Log picker's search layer). A stale value only adds empty space at the end of a list.
    root.style.setProperty('--keyboard-inset', `${Math.max(0, window.innerHeight - vv.height - vv.offsetTop)}px`);
    // The keyboard opening (or closing) is a height change. A dialog that has just been squeezed
    // into what is left may now hold its focused field below its own fold, so reveal it there.
    // Fields on the page are left to the browser: Safari already reveals those itself, and in the
    // app lib/native/keyboard.js does it (the plugin removes WebKit's own).
    if (lastHeight !== null && lastHeight !== vv.height) revealFocusedField({ onPage: false });
    lastHeight = vv.height;
  };
  // A frame later, so layout has caught up with the change before anything is measured; and one
  // publish per frame however many events Safari sends while the keyboard animates.
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(publish);
  };
  // Moving to another field in a dialog with the keyboard already up resizes nothing.
  const onFocusIn = () => requestAnimationFrame(() => revealFocusedField({ onPage: false }));

  const onWindowResize = () => {
    publishWindowHeight();
    schedule();
  };

  publish();
  vv.addEventListener('resize', schedule);
  vv.addEventListener('scroll', schedule);
  window.addEventListener('resize', onWindowResize);
  document.addEventListener('focusin', onFocusIn);

  return () => {
    vv.removeEventListener('resize', schedule);
    vv.removeEventListener('scroll', schedule);
    window.removeEventListener('resize', onWindowResize);
    document.removeEventListener('focusin', onFocusIn);
    if (frame) cancelAnimationFrame(frame);
    root.style.removeProperty('--window-height');
    root.style.removeProperty('--visible-viewport-top');
    root.style.removeProperty('--visible-viewport-height');
    root.style.removeProperty('--keyboard-inset');
  };
}

// Makes the focused text field visible, if it is not already. A field already in view never moves.
//   - Inside a Modal: scrolls the modal's own panel, clear of its sticky header.
//   - On the page (only when `onPage`): scrolls the page, clear of the sticky tab bar at the top and
//     of the SessionBar and the keyboard at the bottom.
export function revealFocusedField({ onPage = true } = {}) {
  const el = document.activeElement;
  if (!el?.matches?.(FIELD)) return;
  // A full-screen fixed layer with its field pinned at the top (the Log picker's search) has
  // nothing to reveal, and scrolling the page under it would only move the page the person comes
  // back to.
  if (el.closest('[data-keyboard-layer]')) return;
  const panel = el.closest('[data-modal-panel]');
  if (panel) {
    revealInPanel(panel, el);
    return;
  }
  if (onPage) revealOnPage(el);
}

function revealInPanel(panel, el) {
  const rect = el.getBoundingClientRect();
  const panelRect = panel.getBoundingClientRect();
  const band = visibleBand();
  // The header is sticky and paints over the top of the panel's scrolled content.
  const header = panel.querySelector('[data-modal-header]');
  const top = Math.max(panelRect.top + (header ? header.getBoundingClientRect().height : 0), band.top) + EDGE_PX;
  const bottom = Math.min(panelRect.bottom, band.bottom) - EDGE_PX;
  // Too tall to fit (a big text area): show its top, where the caret starts.
  if (rect.top < top || rect.height > bottom - top) panel.scrollTop -= top - rect.top;
  else if (rect.bottom > bottom) panel.scrollTop += rect.bottom - bottom;
}

function revealOnPage(el) {
  const rect = el.getBoundingClientRect();
  const band = visibleBand();
  // The sticky .app-chrome paints over whatever scrolls beneath it. Measured, never guessed: its
  // height depends on how many people are in the household.
  const chrome = document.querySelector('.app-chrome');
  const top = Math.max(band.top, chrome ? chrome.getBoundingClientRect().bottom : 0);
  // SessionBar publishes its own height (frontend-core.md, "The bottom chrome"). In the app it rides
  // on top of the keyboard; in Safari it stays at the bottom of the layout viewport, behind it.
  const bottom = Math.min(band.bottom, window.innerHeight - readPx('--bottom-bar-height'));

  if (rect.top >= top && rect.bottom <= bottom) return;
  // Logged because a reveal is a scroll nobody asked for: when one fights another scroll, this line
  // is the only trace of it in the app's console.
  console.info(`[keyboard] reveal ${el.getAttribute('placeholder') ?? el.id ?? el.tagName} (field ${Math.round(rect.top)}-${Math.round(rect.bottom)}, visible ${Math.round(top)}-${Math.round(bottom)})`);
  el.scrollIntoView({ block: 'center' });
}
