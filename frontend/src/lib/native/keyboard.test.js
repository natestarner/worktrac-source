import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const env = vi.hoisted(() => ({
  native: false,
  listeners: [],
  addListener: vi.fn(),
}));
vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => env.native,
    getPlatform: () => (env.native ? 'ios' : 'web'),
  },
  registerPlugin: () => ({}),
}));
vi.mock('@capacitor/keyboard', () => ({
  Keyboard: { addListener: (...args) => env.addListener(...args) },
}));

import { keepFocusedFieldVisible } from './keyboard';

// Lets the adapter's async setup (dynamic import, addListener) run to completion.
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

// A focused input whose box sits at `top`..`bottom` in a 600px-tall WebView.
function focusField({ top, bottom, tag = 'input' }) {
  const el = document.createElement(tag);
  el.getBoundingClientRect = () => ({ top, bottom, left: 0, right: 100, width: 100, height: bottom - top });
  el.scrollIntoView = vi.fn();
  document.body.appendChild(el);
  el.focus();
  return el;
}

const keyboardDidShow = () => env.listeners.find((l) => l.event === 'keyboardDidShow').fn();

let stop = () => {};

beforeEach(() => {
  env.native = false;
  env.listeners = [];
  env.addListener.mockReset();
  env.addListener.mockImplementation(async (event, fn) => {
    const entry = { event, fn, remove: vi.fn() };
    env.listeners.push(entry);
    return entry;
  });
  vi.stubGlobal('requestAnimationFrame', (cb) => {
    cb();
    return 1;
  });
  vi.stubGlobal('innerHeight', 600);
  document.documentElement.style.removeProperty('--bottom-bar-height');
});

afterEach(() => {
  stop();
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

describe('keepFocusedFieldVisible', () => {
  // The web branch: Safari already keeps the field in view, so nothing listens at all.
  it('does nothing on the web', async () => {
    const add = vi.spyOn(document, 'addEventListener');
    stop = keepFocusedFieldVisible();
    await settle();
    const field = focusField({ top: 700, bottom: 740 });
    expect(env.addListener).not.toHaveBeenCalled();
    expect(add).not.toHaveBeenCalledWith('focusin', expect.anything());
    expect(field.scrollIntoView).not.toHaveBeenCalled();
    add.mockRestore();
  });

  it('scrolls a field the keyboard is covering to the middle of what is left', async () => {
    env.native = true;
    stop = keepFocusedFieldVisible();
    await settle();
    const field = focusField({ top: 620, bottom: 660 });
    field.scrollIntoView.mockClear();
    keyboardDidShow();
    expect(field.scrollIntoView).toHaveBeenCalledWith({ block: 'center' });
  });

  it('never moves a field that is already in view', async () => {
    env.native = true;
    stop = keepFocusedFieldVisible();
    await settle();
    const field = focusField({ top: 200, bottom: 240 });
    keyboardDidShow();
    expect(field.scrollIntoView).not.toHaveBeenCalled();
  });

  it('counts the SessionBar riding on the keyboard as covered', async () => {
    env.native = true;
    document.documentElement.style.setProperty('--bottom-bar-height', '72px');
    stop = keepFocusedFieldVisible();
    await settle();
    const field = focusField({ top: 520, bottom: 560 });
    field.scrollIntoView.mockClear();
    keyboardDidShow();
    expect(field.scrollIntoView).toHaveBeenCalledWith({ block: 'center' });
  });

  // With the keyboard already up, moving to the next field fires no keyboard event.
  it('reveals a field focused while the keyboard is already open', async () => {
    env.native = true;
    stop = keepFocusedFieldVisible();
    await settle();
    const field = focusField({ top: 650, bottom: 690 });
    expect(field.scrollIntoView).toHaveBeenCalledWith({ block: 'center' });
  });

  it('leaves anything that is not a text field alone', async () => {
    env.native = true;
    stop = keepFocusedFieldVisible();
    await settle();
    const button = focusField({ top: 650, bottom: 690, tag: 'button' });
    keyboardDidShow();
    expect(button.scrollIntoView).not.toHaveBeenCalled();
  });

  it('stops listening when stopped', async () => {
    env.native = true;
    stop = keepFocusedFieldVisible();
    await settle();
    const listener = env.listeners[0];
    stop();
    stop = () => {};
    expect(listener.remove).toHaveBeenCalled();
    const field = focusField({ top: 650, bottom: 690 });
    expect(field.scrollIntoView).not.toHaveBeenCalled();
  });
});
