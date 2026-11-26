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

  const publish = () => {
    frame = 0;
    root.style.setProperty('--visible-viewport-top', `${vv.offsetTop}px`);
    root.style.setProperty('--visible-viewport-height', `${vv.height}px`);
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

  publish();
  vv.addEventListener('resize', schedule);
  vv.addEventListener('scroll', schedule);
  document.addEventListener('focusin', onFocusIn);

  return () => {
    vv.removeEventListener('resize', schedule);
    vv.removeEventListener('scroll', schedule);
    document.removeEventListener('focusin', onFocusIn);
    if (frame) cancelAnimationFrame(frame);
    root.style.removeProperty('--visible-viewport-top');
    root.style.removeProperty('--visible-viewport-height');
  };
}

// Makes the focused text field visible, if it is not already. A field already in view never moves.
//   - Inside a Modal: scrolls the modal's own panel, clear of its sticky header.
//   - On the page (only when `onPage`): scrolls the page, clear of the sticky tab bar at the top and
//     of the SessionBar and the keyboard at the bottom.
export function revealFocusedField({ onPage = true } = {}) {
  const el = document.activeElement;
  if (!el?.matches?.(FIELD)) return;
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

  // A field that scrolls ITSELF to the top on focus says so (`data-reveal="start"`, the Log
  // search), and is PUT there once the keyboard has settled, even when it is already in view.
  // Its own smooth scroll races the keyboard: while the window shrinks, WebKit can cut a smooth
  // scroll short. Seen on the simulator both ways (2026-11-25): stopped part-way and then centred
  // by the old reveal below (the TestFlight "up, then back to the middle"), or stopped part-way
  // and left mid-screen. This runs after the keyboard's last event, so nothing cuts it short. It
  // lands where the field's own scroll aims: its scroll-margin-top below the top of what is
  // visible, clear of the sticky chrome. Where the page cannot scroll that far (a short page), it
  // does nothing visible.
  if (el.dataset?.reveal === 'start') {
    const margin = parseFloat(getComputedStyle(el).scrollMarginTop) || 0;
    const target = band.top + margin;
    if (Math.abs(rect.top - target) <= 2) return;
    console.info(`[keyboard] reveal ${el.getAttribute('placeholder') ?? el.id ?? el.tagName} to its start (field ${Math.round(rect.top)}, target ${Math.round(target)})`);
    el.scrollIntoView({ block: 'start' });
    return;
  }

  if (rect.top >= top && rect.bottom <= bottom) return;
  // Logged because a reveal is a scroll nobody asked for: when one fights another scroll, this line
  // is the only trace of it in the app's console.
  console.info(`[keyboard] reveal ${el.getAttribute('placeholder') ?? el.id ?? el.tagName} (field ${Math.round(rect.top)}-${Math.round(rect.bottom)}, visible ${Math.round(top)}-${Math.round(bottom)})`);
  el.scrollIntoView({ block: 'center' });
}
