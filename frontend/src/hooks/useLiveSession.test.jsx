import { QueryClient, QueryClientProvider, dehydrate, hydrate, onlineManager } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useLiveSession } from './useLiveSession';
import { markSessionEnded } from '../lib/endedSessions';
import { persistOptions } from '../lib/queryClient';
import { queryKeys } from '../api/queryKeys';
import { getLiveSession } from '../api/sessions';

vi.mock('../api/sessions', () => ({ getLiveSession: vi.fn() }));

function renderWithClient(client, personId) {
  return renderHook(() => useLiveSession(personId), {
    wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
  });
}

// Ending a workout clears the liveSession query entry, but that clear only reaches disk on the
// persister's next throttled tick. swUpdate.js's tryForceUpdate silently reloads on ordinary
// navigation whenever a new SW build is available (always true just after a deploy), so a reload
// inside that window hydrates a snapshot from BEFORE the end and the finished session comes back
// carrying a REAL id -- which contextSessionId then treats as live, rendering that session's
// still-cached sets under "This session". Only reproducible with the service worker, which is why
// this only ever showed on lower (SW is disabled in vite dev and Vitest).
describe('useLiveSession suppresses a session this device already ended', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    getLiveSession.mockImplementation(() => new Promise(() => {})); // offline: never resolves
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('ignores an ended session restored from the persisted cache after a reload', () => {
    const endedSession = { id: 101, startedAt: '2026-08-07T11:19:00Z' };

    // Mid-workout, and this is what the persister has on disk.
    const beforeEnd = new QueryClient();
    beforeEnd.setQueryData(queryKeys.liveSession(7), endedSession);
    const onDisk = dehydrate(beforeEnd, persistOptions.dehydrateOptions);

    // End the workout -- the marker is written synchronously, unlike the throttled persist.
    markSessionEnded(7, endedSession.id);

    // The reload beats that persist, so boot restores the finished session.
    const afterReload = new QueryClient();
    hydrate(afterReload, onDisk);
    expect(afterReload.getQueryData(queryKeys.liveSession(7))).toEqual(endedSession);

    const { result } = renderWithClient(afterReload, 7);

    // The hook must not report it as live, or contextSessionId picks up a real id for a finished
    // session and its cached sets render as "This session".
    expect(result.current.session).toBeNull();
  });

  it('still reports a genuinely new session started after the ended one', () => {
    markSessionEnded(7, 101);

    const client = new QueryClient();
    const newSession = { id: 102, startedAt: '2026-08-07T12:00:00Z' };
    client.setQueryData(queryKeys.liveSession(7), newSession);

    const { result } = renderWithClient(client, 7);

    // Session ids are never reused, so the marker can only ever match the one it was written for.
    expect(result.current.session).toEqual(newSession);
  });

  it('scopes the marker per person', () => {
    markSessionEnded(7, 101);

    const client = new QueryClient();
    const otherPersonsSession = { id: 101, startedAt: '2026-08-07T12:00:00Z' };
    client.setQueryData(queryKeys.liveSession(8), otherPersonsSession);

    const { result } = renderWithClient(client, 8);

    expect(result.current.session).toEqual(otherPersonsSession);
  });
});

// The mirror image of the guard above, and the reason `staleTime` here is a function rather than a
// number. There the restored entry carried a REAL id for a session that was over; here it carries a
// provisional `{ id: null }` that the CLIENT invented in logSetMutation.onMutate while no session
// had synced yet. Its dataUpdatedAt therefore describes the moment we made it up -- and once that
// survives a reload it satisfies this query's staleTime, the global 60s default AND
// offlineCacheWarm's 30s check, so nothing ever asks the server for the real session id.
// contextSessionId then stays null, the sessionSets query never runs, and the person's own sets
// vanish from "This session" despite having synced fine.
// See docs/incidents/2026-08-12-provisional-live-session-restored-as-fresh.md.
//
// Suppression would be wrong here (that would kill the offline "Session in progress" banner) --
// what it needs is to never count as fresh.
describe('useLiveSession revalidates a provisional session restored from the persisted cache', () => {
  const PROVISIONAL = { id: null, startedAt: '2026-08-12T09:00:00Z' };
  const REAL = { id: 101, startedAt: '2026-08-12T09:00:00Z' };

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
    onlineManager.setOnline(true);
  });

  // Round-trips through the app's REAL persistOptions rather than asserting by inspection, so this
  // reproduces what a reload actually restores -- including the dataUpdatedAt that is the whole bug.
  function reloadWith(entries) {
    const beforeReload = new QueryClient();
    entries.forEach(([personId, data]) => beforeReload.setQueryData(queryKeys.liveSession(personId), data));
    const onDisk = dehydrate(beforeReload, persistOptions.dehydrateOptions);

    const afterReload = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    hydrate(afterReload, onDisk);
    return afterReload;
  }

  // Nothing else in the app can correct this: liveSession is deliberately NOT on
  // offlineCacheWarm's refreshAfterRestore list (EndWorkoutConfirmModal optimistically nulls it),
  // and after the outbox has drained there is no replaying write left whose onSettled would
  // invalidate it. The refetch has to come from the hook itself.
  it('refetches it on mount and reports the real session', async () => {
    getLiveSession.mockResolvedValue(REAL);
    const client = reloadWith([[7, PROVISIONAL]]);
    // It survived the round trip looking perfectly fresh -- that is the trap, not an aside.
    expect(client.getQueryData(queryKeys.liveSession(7))).toEqual(PROVISIONAL);

    const { result } = renderWithClient(client, 7);

    await waitFor(() => expect(result.current.session).toEqual(REAL));
    expect(getLiveSession).toHaveBeenCalledWith(7);
  });

  // The other half: this must not degrade into "always refetch". A real session inside the 10s
  // window is a genuine server answer and still paints without a request.
  it('leaves a restored REAL session inside the 10s window alone', async () => {
    getLiveSession.mockResolvedValue({ id: 999, startedAt: '2026-08-12T10:00:00Z' });
    const client = reloadWith([[7, REAL]]);

    const { result } = renderWithClient(client, 7);

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(getLiveSession).not.toHaveBeenCalled();
    expect(result.current.session).toEqual(REAL);
  });

  // Offline the revalidation simply pauses, so the placeholder keeps rendering. If this ever
  // blanked, a reload mid-outage would lose the "Session in progress" banner and the pill dot for
  // the rest of the outage -- trading one bug for a worse one.
  it('keeps rendering the placeholder while offline instead of blanking it', async () => {
    onlineManager.setOnline(false);
    getLiveSession.mockImplementation(() => new Promise(() => {}));
    const client = reloadWith([[7, PROVISIONAL]]);

    const { result } = renderWithClient(client, 7);

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(result.current.session).toEqual(PROVISIONAL);
  });

  // staleTime is resolved per Query, not once for the hook -- so one person holding a provisional
  // session cannot drag another person's cache entry into a refetch. Per-person isolation is the
  // one property this whole area is least allowed to get wrong.
  it('revalidates only the person whose session is provisional', async () => {
    getLiveSession.mockResolvedValue(REAL);
    const othersSession = { id: 55, startedAt: '2026-08-12T08:00:00Z' };
    const client = reloadWith([
      [7, PROVISIONAL],
      [8, othersSession],
    ]);

    renderWithClient(client, 7);
    renderWithClient(client, 8);

    await waitFor(() => expect(getLiveSession).toHaveBeenCalledWith(7));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(getLiveSession).not.toHaveBeenCalledWith(8);
    expect(client.getQueryData(queryKeys.liveSession(8))).toEqual(othersSession);
  });
});
