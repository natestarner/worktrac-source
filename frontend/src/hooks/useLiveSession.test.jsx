import { QueryClient, QueryClientProvider, dehydrate, hydrate } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react';
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
