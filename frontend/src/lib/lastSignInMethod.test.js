import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  describeSignInMethods,
  lastSignInMethod,
  rememberSignInMethod,
  usedSignInMethods,
} from './lastSignInMethod';

const KEY = 'huddle-last-sign-in-method';
const ALL_KEY = 'huddle-sign-in-methods';

describe('usedSignInMethods', () => {
  beforeEach(() => {
    localStorage.removeItem(KEY);
    localStorage.removeItem(ALL_KEY);
  });
  afterEach(() => vi.restoreAllMocks());

  // A family iPad: one person uses Apple, another Google. Both stay known, so neither is told the
  // other's way is "theirs".
  it('remembers every way this device has signed in, once each, oldest first', () => {
    for (const method of ['apple', 'google', 'apple', 'password']) rememberSignInMethod(method);
    expect(usedSignInMethods()).toEqual(['apple', 'google', 'password']);
    expect(lastSignInMethod()).toBe('password');
  });

  it('is empty on a device that has never signed in', () => {
    expect(usedSignInMethods()).toEqual([]);
  });

  // Axis D: a device that signed in before the list existed has only the last-used key.
  it('counts the last-used method on a device that predates the list', () => {
    localStorage.setItem(KEY, 'apple');
    expect(usedSignInMethods()).toEqual(['apple']);
    rememberSignInMethod('google');
    // ...and moving the last-used key on must not forget it.
    expect(usedSignInMethods()).toEqual(['apple', 'google']);
  });

  it('ignores a corrupt or hand-edited list rather than throwing', () => {
    localStorage.setItem(ALL_KEY, '{not json');
    expect(usedSignInMethods()).toEqual([]);
    localStorage.setItem(ALL_KEY, JSON.stringify(['facebook', 'apple', 'apple']));
    expect(usedSignInMethods()).toEqual(['apple']);
  });

  it('never throws when storage refuses', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('SecurityError');
    });
    expect(usedSignInMethods()).toEqual([]);
  });
});

describe('describeSignInMethods', () => {
  it('reads as a sentence', () => {
    expect(describeSignInMethods([])).toBe('');
    expect(describeSignInMethods(['apple'])).toBe('Apple');
    expect(describeSignInMethods(['apple', 'google'])).toBe('Apple or Google');
    expect(describeSignInMethods(['apple', 'google', 'password'])).toBe('Apple, Google or your email and password');
  });
});

describe('lastSignInMethod', () => {
  beforeEach(() => {
    localStorage.removeItem(KEY);
    localStorage.removeItem(ALL_KEY);
  });
  afterEach(() => vi.restoreAllMocks());

  it('remembers each known way of signing in, the latest winning', () => {
    for (const method of ['apple', 'google', 'test', 'password']) {
      rememberSignInMethod(method);
      expect(lastSignInMethod()).toBe(method);
    }
  });

  it('is null on a device that has never signed in', () => {
    expect(lastSignInMethod()).toBeNull();
  });

  // A stale or hand-edited value must show no hint rather than a badge on nothing (or a crash).
  it('ignores values it does not know, both written and read', () => {
    rememberSignInMethod('facebook');
    expect(localStorage.getItem(KEY)).toBeNull();
    localStorage.setItem(KEY, 'facebook');
    expect(lastSignInMethod()).toBeNull();
  });

  // Private mode and a full quota throw from localStorage. Signing in must never fail over a hint.
  it('never throws when storage refuses: no hint, nothing else', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('QuotaExceededError');
    });
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('SecurityError');
    });
    expect(() => rememberSignInMethod('apple')).not.toThrow();
    expect(lastSignInMethod()).toBeNull();
  });
});
