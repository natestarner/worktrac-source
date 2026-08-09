import { QueryClient, QueryClientProvider, onlineManager, IsRestoringProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithQuery } from '../test/queryWrapper';
import { useOfflineCacheWarming, WARM_INTERVAL_MS } from './useOfflineCacheWarming';

vi.mock('../lib/offlineCacheWarm', () => ({
  warmOfflineCache: vi.fn().mockResolvedValue(undefined),
}));

import { warmOfflineCache } from '../lib/offlineCacheWarm';

const PEOPLE = [{ id: 1 }, { id: 2 }];

function setVisibility(state) {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
}

function Probe({ people }) {
  useOfflineCacheWarming(people);
  return null;
}

// Simulates being rendered under PersistQueryClientProvider while its cache restore is still in
// flight -- renderWithQuery's plain QueryClientProvider never sets this, so useIsRestoring()
// otherwise defaults to false (see @tanstack/react-query's IsRestoringProvider).
function ProbeRestoring({ people, isRestoring }) {
  return (
    <IsRestoringProvider value={isRestoring}>
      <Probe people={people} />
    </IsRestoringProvider>
  );
}

describe('useOfflineCacheWarming', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    onlineManager.setOnline(true);
    setVisibility('visible');
  });

  afterEach(() => {
    vi.useRealTimers();
    onlineManager.setOnline(true);
    setVisibility('visible');
  });

  // The mount warm is the only one running against a cache that came off disk, so it's the only
  // one allowed to refetch entries that still look fresh -- see warmOfflineCache's
  // refreshAfterRestore note and issue #146.
  it('warms once on mount, flagged as the post-restore warm', () => {
    renderWithQuery(<Probe people={PEOPLE} />);
    expect(warmOfflineCache).toHaveBeenCalledTimes(1);
    expect(warmOfflineCache).toHaveBeenCalledWith(expect.anything(), PEOPLE, { afterRestore: true });
  });

  it('warms again on the online transition, WITHOUT the post-restore flag', () => {
    renderWithQuery(<Probe people={PEOPLE} />);
    expect(warmOfflineCache).toHaveBeenCalledTimes(1);

    onlineManager.setOnline(false);
    expect(warmOfflineCache).toHaveBeenCalledTimes(1);

    onlineManager.setOnline(true);
    expect(warmOfflineCache).toHaveBeenCalledTimes(2);
    // By now the cache is whatever this page session fetched, so ordinary staleness applies.
    expect(warmOfflineCache).toHaveBeenLastCalledWith(expect.anything(), PEOPLE);
  });

  it('warms again when the tab regains visibility while online', () => {
    renderWithQuery(<Probe people={PEOPLE} />);
    expect(warmOfflineCache).toHaveBeenCalledTimes(1);

    setVisibility('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(warmOfflineCache).toHaveBeenCalledTimes(1);

    setVisibility('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(warmOfflineCache).toHaveBeenCalledTimes(2);
  });

  it('does NOT warm on regaining visibility while offline', () => {
    renderWithQuery(<Probe people={PEOPLE} />);
    onlineManager.setOnline(false);
    setVisibility('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    setVisibility('visible');
    document.dispatchEvent(new Event('visibilitychange'));

    expect(warmOfflineCache).toHaveBeenCalledTimes(1); // only the initial mount warm
  });

  it('warms periodically while foregrounded and online', () => {
    renderWithQuery(<Probe people={PEOPLE} />);
    expect(warmOfflineCache).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(WARM_INTERVAL_MS);
    expect(warmOfflineCache).toHaveBeenCalledTimes(2);

    vi.advanceTimersByTime(WARM_INTERVAL_MS);
    expect(warmOfflineCache).toHaveBeenCalledTimes(3);
  });

  it('skips the periodic warm while backgrounded', () => {
    renderWithQuery(<Probe people={PEOPLE} />);
    setVisibility('hidden');

    vi.advanceTimersByTime(WARM_INTERVAL_MS);

    expect(warmOfflineCache).toHaveBeenCalledTimes(1); // only the initial mount warm
  });

  it('skips the periodic warm while offline', () => {
    renderWithQuery(<Probe people={PEOPLE} />);
    onlineManager.setOnline(false);

    vi.advanceTimersByTime(WARM_INTERVAL_MS);

    expect(warmOfflineCache).toHaveBeenCalledTimes(1); // only the initial mount warm
  });

  // The lie-fi reload bug: warmOfflineCache's prefetchQuery calls are imperative and, unlike a
  // useQuery observer, are NOT automatically held back while PersistQueryClientProvider is still
  // restoring the persisted cache. Without this gate, a warm attempt could race the cache
  // hydrate() and leave history/live-session stuck data-less against a dead-but-reachable backend.
  it('does not warm while the persisted cache is still restoring', () => {
    // Plain render + a fixed wrapper (rather than renderWithQuery) so `rerender` keeps the same
    // QueryClientProvider across the isRestoring flip below -- renderWithQuery wraps `ui` inline,
    // and RTL's rerender swaps out exactly what's passed to it, which would otherwise drop that
    // wrapping on the second render.
    const client = new QueryClient();
    const { rerender } = render(<ProbeRestoring people={PEOPLE} isRestoring />, {
      wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
    });
    expect(warmOfflineCache).not.toHaveBeenCalled();

    rerender(<ProbeRestoring people={PEOPLE} isRestoring={false} />);
    expect(warmOfflineCache).toHaveBeenCalledTimes(1);
  });

  it('does not warm on an online transition or periodic tick while still restoring', () => {
    renderWithQuery(<ProbeRestoring people={PEOPLE} isRestoring />);

    onlineManager.setOnline(false);
    onlineManager.setOnline(true);
    vi.advanceTimersByTime(WARM_INTERVAL_MS);

    expect(warmOfflineCache).not.toHaveBeenCalled();
  });

  it('clears the interval and listeners on unmount', () => {
    const { unmount } = renderWithQuery(<Probe people={PEOPLE} />);
    unmount();

    vi.advanceTimersByTime(WARM_INTERVAL_MS * 2);
    onlineManager.setOnline(false);
    onlineManager.setOnline(true);
    document.dispatchEvent(new Event('visibilitychange'));

    expect(warmOfflineCache).toHaveBeenCalledTimes(1); // only the initial mount warm
  });
});
