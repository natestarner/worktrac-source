import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { lastSignInMethod, rememberSignInMethod } from './lastSignInMethod';

const KEY = 'huddle-last-sign-in-method';

describe('lastSignInMethod', () => {
  beforeEach(() => localStorage.removeItem(KEY));
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
