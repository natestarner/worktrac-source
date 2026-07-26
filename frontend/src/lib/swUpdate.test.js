import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  POLL_INTERVAL_MS,
  __resetSwUpdateForTests,
  applyUpdate,
  isUpdateAvailable,
  markUpdateAvailable,
  startUpdatePolling,
  subscribeUpdateAvailable,
  tryForceUpdate,
} from './swUpdate';
import { hasInFlightWrite } from './pendingWrites';

vi.mock('./pendingWrites', () => ({ hasInFlightWrite: vi.fn() }));

describe('swUpdate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hasInFlightWrite.mockReturnValue(false);
  });

  afterEach(() => __resetSwUpdateForTests());

  describe('markUpdateAvailable / isUpdateAvailable / subscribeUpdateAvailable', () => {
    it('starts unavailable', () => {
      expect(isUpdateAvailable()).toBe(false);
    });

    it('becomes available once marked, and notifies subscribers', () => {
      const listener = vi.fn();
      const unsubscribe = subscribeUpdateAvailable(listener);

      markUpdateAvailable(vi.fn());

      expect(isUpdateAvailable()).toBe(true);
      expect(listener).toHaveBeenCalledWith(true);
      unsubscribe();
    });
  });

  describe('applyUpdate', () => {
    it('calls the stashed update function with true', () => {
      const updateSW = vi.fn();
      markUpdateAvailable(updateSW);

      applyUpdate();

      expect(updateSW).toHaveBeenCalledWith(true);
    });

    it('is a no-op when nothing has been marked available', () => {
      expect(() => applyUpdate()).not.toThrow();
    });
  });

  describe('tryForceUpdate', () => {
    it('does nothing and returns false when no update is available', () => {
      const queryClient = {};
      expect(tryForceUpdate(queryClient, 7)).toBe(false);
    });

    it('applies and returns true when available and no in-flight write', () => {
      const updateSW = vi.fn();
      markUpdateAvailable(updateSW);
      hasInFlightWrite.mockReturnValue(false);
      const queryClient = {};

      expect(tryForceUpdate(queryClient, 7)).toBe(true);
      expect(updateSW).toHaveBeenCalledWith(true);
    });

    it('skips and returns false when a write for this person is in flight', () => {
      const updateSW = vi.fn();
      markUpdateAvailable(updateSW);
      hasInFlightWrite.mockReturnValue(true);
      const queryClient = {};

      expect(tryForceUpdate(queryClient, 7)).toBe(false);
      expect(updateSW).not.toHaveBeenCalled();
    });

    it('checks in-flight status for the exact personId passed in', () => {
      markUpdateAvailable(vi.fn());
      const queryClient = {};

      tryForceUpdate(queryClient, 42);

      expect(hasInFlightWrite).toHaveBeenCalledWith(queryClient, 42);
    });
  });

  describe('startUpdatePolling', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('calls registration.update() on the poll interval', () => {
      const registration = { update: vi.fn().mockResolvedValue() };
      const stop = startUpdatePolling(registration);

      expect(registration.update).not.toHaveBeenCalled();
      vi.advanceTimersByTime(POLL_INTERVAL_MS);
      expect(registration.update).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(POLL_INTERVAL_MS);
      expect(registration.update).toHaveBeenCalledTimes(2);

      stop();
    });

    it('calls registration.update() when the tab becomes visible again', () => {
      const registration = { update: vi.fn().mockResolvedValue() };
      startUpdatePolling(registration);

      Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));

      expect(registration.update).toHaveBeenCalledTimes(1);
    });

    it('does not check on visibilitychange when the tab becomes hidden', () => {
      const registration = { update: vi.fn().mockResolvedValue() };
      startUpdatePolling(registration);

      Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));

      expect(registration.update).not.toHaveBeenCalled();
    });

    it('stops polling and stops listening once the returned cleanup runs', () => {
      const registration = { update: vi.fn().mockResolvedValue() };
      const stop = startUpdatePolling(registration);

      stop();
      vi.advanceTimersByTime(POLL_INTERVAL_MS * 3);
      Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));

      expect(registration.update).not.toHaveBeenCalled();
    });

    it('is a safe no-op when there is no registration', () => {
      expect(() => startUpdatePolling(null)()).not.toThrow();
    });
  });
});
