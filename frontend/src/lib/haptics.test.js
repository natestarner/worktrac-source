import { afterEach, describe, expect, it, vi } from 'vitest';
import { tryHaptic } from './haptics';

function setMatchMedia(reduced) {
  window.matchMedia = vi.fn().mockReturnValue({ matches: reduced });
}

afterEach(() => {
  delete navigator.vibrate;
  vi.restoreAllMocks();
});

describe('tryHaptic', () => {
  it('uses the Vibration API where it exists', () => {
    setMatchMedia(false);
    navigator.vibrate = vi.fn().mockReturnValue(true);

    expect(tryHaptic('celebrate')).toBe('vibrate');
    // Two quick taps for a PR; one softer tick for finishing.
    expect(navigator.vibrate).toHaveBeenCalledWith([18, 60, 30]);

    expect(tryHaptic('complete')).toBe('vibrate');
    expect(navigator.vibrate).toHaveBeenLastCalledWith([24]);
  });

  it('reports a refusal rather than claiming success', () => {
    setMatchMedia(false);
    // A UA may decline -- a background tab, or outside a user gesture.
    navigator.vibrate = vi.fn().mockReturnValue(false);
    expect(tryHaptic()).toBe('refused');
  });

  // There is no `prefers-reduced-haptics`, so reduced-motion stands in for "less non-essential
  // feedback". Erring toward silence is the safe direction -- see the module header.
  it('stays silent when the person asked for reduced motion', () => {
    setMatchMedia(true);
    navigator.vibrate = vi.fn();

    expect(tryHaptic('celebrate')).toBe('suppressed');
    expect(navigator.vibrate).not.toHaveBeenCalled();
  });

  // The case that matters most: iOS Safari, where navigator.vibrate does not exist at all. jsdom
  // has no `switch` support either, so this lands on the honest bottom branch rather than
  // pretending.
  it('degrades to a reported no-op where nothing is available', () => {
    setMatchMedia(false);
    expect(tryHaptic()).toBe('unsupported');
  });

  // A haptic is decoration. It may never be the reason a PR celebration or an ended workout
  // fails, so a throwing platform must still return normally.
  it('never throws, whatever the platform does', () => {
    setMatchMedia(false);
    navigator.vibrate = vi.fn(() => {
      throw new Error('nope');
    });

    expect(() => tryHaptic('celebrate')).not.toThrow();
    expect(tryHaptic('celebrate')).toBe('error');
  });

  it('survives matchMedia itself being unavailable', () => {
    window.matchMedia = undefined;
    navigator.vibrate = vi.fn().mockReturnValue(true);

    expect(tryHaptic()).toBe('vibrate');
  });

  it('falls back to the default pattern for an unknown name', () => {
    setMatchMedia(false);
    navigator.vibrate = vi.fn().mockReturnValue(true);

    tryHaptic('not-a-pattern');
    expect(navigator.vibrate).toHaveBeenCalledWith([24]);
  });
});
