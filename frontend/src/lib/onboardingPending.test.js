import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearOnboardingPending, isOnboardingPending, markOnboardingPending } from './onboardingPending';

describe('onboardingPending', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('round-trips: marked, then reported pending', () => {
    markOnboardingPending(7);
    expect(isOnboardingPending(7)).toBe(true);
  });

  it('is false before anything is marked', () => {
    expect(isOnboardingPending(7)).toBe(false);
  });

  it('clears the flag', () => {
    markOnboardingPending(7);
    clearOnboardingPending(7);
    expect(isOnboardingPending(7)).toBe(false);
  });

  // A shared device with two households registered on it must never show one account's welcome
  // modal to the other.
  it('keeps a second accountId completely independent', () => {
    markOnboardingPending(7);
    expect(isOnboardingPending(8)).toBe(false);

    markOnboardingPending(8);
    clearOnboardingPending(7);
    expect(isOnboardingPending(7)).toBe(false);
    expect(isOnboardingPending(8)).toBe(true);
  });

  it('treats a null or undefined accountId as a no-op rather than throwing', () => {
    expect(() => markOnboardingPending(null)).not.toThrow();
    expect(() => markOnboardingPending(undefined)).not.toThrow();
    expect(isOnboardingPending(null)).toBe(false);
    expect(isOnboardingPending(undefined)).toBe(false);
    expect(() => clearOnboardingPending(null)).not.toThrow();
  });

  // Private mode / quota / disabled storage. This must degrade to "no welcome modal" and must
  // never throw INTO confirmEmail -- a failed write here cannot be allowed to fail registration.
  it('degrades to a no-op when localStorage.setItem throws', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    expect(() => markOnboardingPending(7)).not.toThrow();
  });

  it('degrades to false when localStorage.getItem throws', () => {
    markOnboardingPending(7);
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    expect(isOnboardingPending(7)).toBe(false);
  });

  it('degrades to a no-op when localStorage.removeItem throws', () => {
    markOnboardingPending(7);
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    expect(() => clearOnboardingPending(7)).not.toThrow();
  });
});
