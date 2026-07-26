import { onlineManager } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __resetOfflineModeForTests,
  applyPersistedPin,
  isOfflinePinned,
  pinOffline,
  subscribeOfflinePin,
  unpinOffline,
} from './offlineMode';

const STORAGE_KEY = 'worktrac-offline-pinned';

describe('offlineMode', () => {
  beforeEach(() => {
    localStorage.clear();
    onlineManager.setOnline(true);
  });

  afterEach(() => {
    __resetOfflineModeForTests();
    onlineManager.setOnline(true);
    localStorage.clear();
  });

  it('pinning drives onlineManager offline and persists the flag', () => {
    pinOffline();

    expect(isOfflinePinned()).toBe(true);
    expect(onlineManager.isOnline()).toBe(false);
    expect(localStorage.getItem(STORAGE_KEY)).toBe('1');
  });

  it('unpinning restores onlineManager and clears the persisted flag', () => {
    pinOffline();

    unpinOffline();

    expect(isOfflinePinned()).toBe(false);
    expect(onlineManager.isOnline()).toBe(true);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('while pinned, a browser online event does not un-pin the app', () => {
    pinOffline();

    window.dispatchEvent(new Event('online'));

    expect(isOfflinePinned()).toBe(true);
    expect(onlineManager.isOnline()).toBe(false);
  });

  it('after unpinning, browser online/offline events work again', () => {
    pinOffline();
    unpinOffline();

    window.dispatchEvent(new Event('offline'));
    expect(onlineManager.isOnline()).toBe(false);

    window.dispatchEvent(new Event('online'));
    expect(onlineManager.isOnline()).toBe(true);
  });

  it('notifies subscribers on pin/unpin', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeOfflinePin(listener);

    pinOffline();
    expect(listener).toHaveBeenCalledWith(true);

    unpinOffline();
    expect(listener).toHaveBeenCalledWith(false);

    unsubscribe();
  });

  it('applying a persisted pin pins the app, mirroring what happens at module load on boot', () => {
    localStorage.setItem(STORAGE_KEY, '1');

    applyPersistedPin();

    expect(isOfflinePinned()).toBe(true);
    expect(onlineManager.isOnline()).toBe(false);
  });

  it('applying with no persisted pin leaves the app online', () => {
    applyPersistedPin();

    expect(isOfflinePinned()).toBe(false);
    expect(onlineManager.isOnline()).toBe(true);
  });

  it('applying with no persisted pin but navigator reporting offline seeds onlineManager offline (boot-while-offline)', () => {
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    try {
      applyPersistedPin();

      expect(isOfflinePinned()).toBe(false);
      expect(onlineManager.isOnline()).toBe(false);
    } finally {
      Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
    }
  });
});
