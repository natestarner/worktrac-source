import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { restNotificationsFor, useRestNotifications } from './useRestNotifications';
import { useUI } from '../context/UIContext';
import { useAuth } from '../context/AuthContext';
import {
  cancelRestNotifications,
  ensureRestNotificationPermission,
  scheduleRestNotifications,
} from '../lib/native';

vi.mock('../context/UIContext', () => ({ useUI: vi.fn() }));
vi.mock('../context/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('../lib/native', () => ({
  cancelRestNotifications: vi.fn(),
  ensureRestNotificationPermission: vi.fn(),
  scheduleRestNotifications: vi.fn(),
}));

const NOW = Date.parse('2026-10-21T12:00:00Z');
const people = [
  { id: 1, name: 'Nate', restTimerEnabled: true },
  { id: 2, name: 'Sam', restTimerEnabled: false },
  { id: 3, name: 'Ben' },
];

describe('restNotificationsFor', () => {
  it('nudges each person whose rest is still filling, at the moment it fills', () => {
    const items = restNotificationsFor(
      { 1: { startedAt: NOW - 30_000, targetSeconds: 90, capped: false } },
      people,
      NOW
    );
    expect(items).toEqual([{ personId: '1', at: new Date(NOW + 60_000), name: 'Nate' }]);
  });

  it('skips a person who turned the rest timer off, a capped timer, and one already full', () => {
    const items = restNotificationsFor(
      {
        2: { startedAt: NOW - 10_000, targetSeconds: 90, capped: false },
        3: { startedAt: NOW - 700_000, targetSeconds: 90, capped: true },
        1: { startedAt: NOW - 95_000, targetSeconds: 90, capped: false },
      },
      people,
      NOW
    );
    expect(items).toEqual([]);
  });

  // A person missing from /me's people (a stale timer, a removed person) still gets a nudge, unnamed.
  it('still nudges for a timer whose person is not in the list', () => {
    const items = restNotificationsFor({ 9: { startedAt: NOW, targetSeconds: 60 } }, people, NOW);
    expect(items).toEqual([{ personId: '9', at: new Date(NOW + 60_000), name: null }]);
  });
});

describe('useRestNotifications', () => {
  let visibility = 'visible';

  beforeEach(() => {
    vi.clearAllMocks();
    visibility = 'visible';
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    useAuth.mockReturnValue({ people });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function setVisibility(next) {
    visibility = next;
    document.dispatchEvent(new Event('visibilitychange'));
  }

  it('schedules when the app is backgrounded and cancels when it comes back', () => {
    useUI.mockReturnValue({ restTimers: { 1: { startedAt: NOW - 30_000, targetSeconds: 90, capped: false } } });
    renderHook(() => useRestNotifications());

    setVisibility('hidden');
    expect(scheduleRestNotifications).toHaveBeenCalledWith([
      { personId: '1', at: new Date(NOW + 60_000), name: 'Nate' },
    ]);

    setVisibility('visible');
    expect(cancelRestNotifications).toHaveBeenCalledTimes(1);
  });

  // Asked when resting starts, never at launch.
  it('asks for permission only once a rest timer is running', () => {
    useUI.mockReturnValue({ restTimers: {} });
    const { rerender } = renderHook(() => useRestNotifications());
    expect(ensureRestNotificationPermission).not.toHaveBeenCalled();

    useUI.mockReturnValue({ restTimers: { 1: { startedAt: NOW, targetSeconds: 90, capped: false } } });
    rerender();
    expect(ensureRestNotificationPermission).toHaveBeenCalledTimes(1);
  });
});
