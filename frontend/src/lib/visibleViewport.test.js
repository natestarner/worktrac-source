import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { revealFocusedField, trackVisibleViewport } from './visibleViewport';

// jsdom has no visualViewport and lays nothing out, so both are faked: a visual viewport that can
// "open the keyboard" by shrinking, and boxes pinned with getBoundingClientRect.
function fakeVisualViewport({ offsetTop = 0, height = 800 } = {}) {
  const target = new EventTarget();
  target.offsetTop = offsetTop;
  target.height = height;
  return target;
}

function box(el, top, bottom) {
  el.getBoundingClientRect = () => ({ top, bottom, left: 0, right: 300, width: 300, height: bottom - top });
}

// A Modal panel at `top`..`bottom` with a sticky header of `headerHeight`, holding one input at
// `fieldTop`..`fieldBottom` (client coordinates, as they would be at the current scroll).
function modalWithField({ top, bottom, headerHeight = 60, fieldTop, fieldBottom }) {
  const panel = document.createElement('div');
  panel.setAttribute('data-modal-panel', '');
  box(panel, top, bottom);
  panel.scrollTop = 100;
  const header = document.createElement('div');
  header.setAttribute('data-modal-header', '');
  box(header, top, top + headerHeight);
  const input = document.createElement('input');
  box(input, fieldTop, fieldBottom);
  panel.append(header, input);
  document.body.appendChild(panel);
  return { panel, input };
}

const root = document.documentElement;
let stop = () => {};

beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', (cb) => {
    cb();
    return 1;
  });
  vi.stubGlobal('innerHeight', 800);
});

afterEach(() => {
  stop();
  stop = () => {};
  document.body.innerHTML = '';
  root.style.removeProperty('--visible-viewport-top');
  root.style.removeProperty('--visible-viewport-height');
  vi.unstubAllGlobals();
});

describe('trackVisibleViewport', () => {
  // Every reader falls back to the full viewport, i.e. exactly the behaviour before this existed.
  it('publishes nothing where there is no visualViewport', () => {
    vi.stubGlobal('visualViewport', undefined);
    stop = trackVisibleViewport();
    expect(root.style.getPropertyValue('--visible-viewport-height')).toBe('');
  });

  it('publishes the visible part of the screen, and follows the keyboard opening', () => {
    const vv = fakeVisualViewport({ height: 800 });
    vi.stubGlobal('visualViewport', vv);
    stop = trackVisibleViewport();
    expect(root.style.getPropertyValue('--visible-viewport-top')).toBe('0px');
    expect(root.style.getPropertyValue('--visible-viewport-height')).toBe('800px');

    // The keyboard opens and Safari pans the view down to the field.
    vv.height = 420;
    vv.offsetTop = 180;
    vv.dispatchEvent(new Event('resize'));
    expect(root.style.getPropertyValue('--visible-viewport-top')).toBe('180px');
    expect(root.style.getPropertyValue('--visible-viewport-height')).toBe('420px');
  });

  it('follows a pan with no resize', () => {
    const vv = fakeVisualViewport({ height: 420 });
    vi.stubGlobal('visualViewport', vv);
    stop = trackVisibleViewport();
    vv.offsetTop = 90;
    vv.dispatchEvent(new Event('scroll'));
    expect(root.style.getPropertyValue('--visible-viewport-top')).toBe('90px');
  });

  it('reveals a dialog field the keyboard left below the fold of its panel', () => {
    const vv = fakeVisualViewport({ height: 800 });
    vi.stubGlobal('visualViewport', vv);
    stop = trackVisibleViewport();
    // The panel has been squeezed into 0..420, and the field sits at 500..540 inside it.
    const { panel, input } = modalWithField({ top: 0, bottom: 420, fieldTop: 500, fieldBottom: 540 });
    input.focus();
    panel.scrollTop = 100;

    vv.height = 420;
    vv.dispatchEvent(new Event('resize'));
    // 540 must come up to 420 - 12 = 408: 132px further down the panel.
    expect(panel.scrollTop).toBe(232);
  });

  it('leaves a field on the page to the browser', () => {
    const vv = fakeVisualViewport({ height: 800 });
    vi.stubGlobal('visualViewport', vv);
    stop = trackVisibleViewport();
    const input = document.createElement('input');
    box(input, 600, 640);
    input.scrollIntoView = vi.fn();
    document.body.appendChild(input);
    input.focus();

    vv.height = 420;
    vv.dispatchEvent(new Event('resize'));
    expect(input.scrollIntoView).not.toHaveBeenCalled();
  });

  it('removes what it published when stopped', () => {
    vi.stubGlobal('visualViewport', fakeVisualViewport());
    const stopNow = trackVisibleViewport();
    stopNow();
    expect(root.style.getPropertyValue('--visible-viewport-height')).toBe('');
  });
});

describe('revealFocusedField inside a Modal', () => {
  beforeEach(() => vi.stubGlobal('visualViewport', fakeVisualViewport({ height: 800 })));

  it('never moves a field already in view', () => {
    const { panel, input } = modalWithField({ top: 100, bottom: 600, fieldTop: 200, fieldBottom: 240 });
    input.focus();
    revealFocusedField();
    expect(panel.scrollTop).toBe(100);
  });

  // The header is sticky, so a field scrolled up under it is hidden even though it is in the panel.
  it('brings a field out from under the sticky header', () => {
    const { panel, input } = modalWithField({ top: 100, bottom: 600, headerHeight: 60, fieldTop: 130, fieldBottom: 170 });
    input.focus();
    revealFocusedField();
    // Its top must sit at 100 + 60 + 12 = 172: 42px further up the panel.
    expect(panel.scrollTop).toBe(58);
  });

  it('keeps clear of the keyboard even when the panel itself reaches under it', () => {
    vi.stubGlobal('visualViewport', fakeVisualViewport({ height: 400 }));
    const { panel, input } = modalWithField({ top: 100, bottom: 700, fieldTop: 450, fieldBottom: 490 });
    input.focus();
    revealFocusedField();
    // Visible bottom is 400 - 12 = 388.
    expect(panel.scrollTop).toBe(100 + 490 - 388);
  });

  it('leaves anything that is not a text field alone', () => {
    const { panel } = modalWithField({ top: 100, bottom: 600, fieldTop: 130, fieldBottom: 170 });
    const button = document.createElement('button');
    box(button, 650, 690);
    panel.appendChild(button);
    button.focus();
    revealFocusedField();
    expect(panel.scrollTop).toBe(100);
  });
});

describe('revealFocusedField on the page', () => {
  beforeEach(() => vi.stubGlobal('visualViewport', fakeVisualViewport({ height: 800 })));

  // The search field's focus border used to sit under the tab bar: "in view" must mean below the
  // sticky chrome, measured, not merely below the top of the screen.
  it('counts a field under the sticky chrome as hidden', () => {
    const chrome = document.createElement('div');
    chrome.className = 'app-chrome';
    box(chrome, 0, 141);
    document.body.appendChild(chrome);
    const input = document.createElement('input');
    box(input, 132, 180);
    input.scrollIntoView = vi.fn();
    document.body.appendChild(input);
    input.focus();
    revealFocusedField();
    expect(input.scrollIntoView).toHaveBeenCalledWith({ block: 'center' });
  });

  it('does nothing on the page when asked to leave the page alone', () => {
    const input = document.createElement('input');
    box(input, 900, 940);
    input.scrollIntoView = vi.fn();
    document.body.appendChild(input);
    input.focus();
    revealFocusedField({ onPage: false });
    expect(input.scrollIntoView).not.toHaveBeenCalled();
  });
});
