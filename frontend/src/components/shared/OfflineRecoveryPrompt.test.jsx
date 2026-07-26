import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetOfflineModeForTests, isOfflinePinned, pinOffline, unpinOffline } from '../../lib/offlineMode';
import OfflineRecoveryPrompt from './OfflineRecoveryPrompt';

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
}

describe('OfflineRecoveryPrompt', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    global.fetch = vi.fn();
  });

  afterEach(() => {
    __resetOfflineModeForTests();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('renders nothing while not pinned', () => {
    render(<OfflineRecoveryPrompt />);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('stays hidden until the heartbeat confirms the server is reachable again', async () => {
    global.fetch.mockResolvedValue(new Response(null, { status: 200 }));
    act(() => pinOffline());
    render(<OfflineRecoveryPrompt />);

    expect(screen.queryByRole('status')).toBeNull();

    await act(async () => {
      vi.advanceTimersByTime(5000);
      await flush();
    });

    expect(screen.getByRole('status')).toHaveTextContent(/back online/i);
    expect(screen.getByRole('button', { name: 'Resume syncing' })).toBeInTheDocument();
  });

  it('backs off and keeps polling while the server stays unreachable', async () => {
    global.fetch.mockRejectedValue(new TypeError('Failed to fetch'));
    act(() => pinOffline());
    render(<OfflineRecoveryPrompt />);

    await act(async () => {
      vi.advanceTimersByTime(5000);
      await flush();
    });
    expect(screen.queryByRole('status')).toBeNull();
    expect(global.fetch).toHaveBeenCalledTimes(1);

    // Backed off to 10s (2x) rather than retrying immediately.
    await act(async () => {
      vi.advanceTimersByTime(9999);
      await flush();
    });
    expect(global.fetch).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(1);
      await flush();
    });
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('clicking "Resume syncing" unpins the app', async () => {
    global.fetch.mockResolvedValue(new Response(null, { status: 200 }));
    act(() => pinOffline());
    render(<OfflineRecoveryPrompt />);

    await act(async () => {
      vi.advanceTimersByTime(5000);
      await flush();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Resume syncing' }));

    expect(isOfflinePinned()).toBe(false);
  });

  it('stops polling once unpinned', async () => {
    global.fetch.mockRejectedValue(new TypeError('Failed to fetch'));
    act(() => pinOffline());
    render(<OfflineRecoveryPrompt />);

    await act(async () => {
      vi.advanceTimersByTime(5000);
      await flush();
    });
    expect(global.fetch).toHaveBeenCalledTimes(1);

    act(() => unpinOffline());

    await act(async () => {
      vi.advanceTimersByTime(60000);
      await flush();
    });
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});
