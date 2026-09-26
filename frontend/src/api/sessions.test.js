import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { getHistory } from './sessions';
import { setAuthToken } from './client';
import { queryKeys } from './queryKeys';
import { FULL_SYNC_INTERVAL_MS, HISTORY_FORMAT, flattenHistory } from '../lib/historySync';

// History's month-by-month sync, through the real transport and a real QueryClient. The property
// every test here protects: what the cache ends up holding is exactly the server's month list, each
// month either freshly sent or kept from the copy whose fingerprint the server just confirmed --
// never a month the server did not vouch for, and never a month silently dropped.

const reply = (months, changed = {}) =>
  new Response(JSON.stringify({ months, changed }), { status: 200, headers: { 'content-type': 'application/json' } });

const sentHave = (call) => JSON.parse(global.fetch.mock.calls[call][1].body).have;
const sentUrl = (call) => global.fetch.mock.calls[call][0];

const session = (id, month, reps) => ({
  id,
  startedAt: `${month}-1${id}T12:00:00Z`,
  entries: [{ exerciseId: 1, sets: [{ weight: 100, reps }] }],
});

const synced = (months, fullSyncedAt = Date.now()) => ({ format: HISTORY_FORMAT, months, fullSyncedAt });

describe('getHistory', () => {
  beforeEach(() => {
    setAuthToken('t');
    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('asks for everything when nothing is cached, and returns the months newest first', async () => {
    global.fetch.mockResolvedValueOnce(reply(['2026-06', '2026-05'], {
      '2026-06': { fp: 'a', sessions: [session(2, '2026-06', 5)] },
      '2026-05': { fp: 'b', sessions: [session(1, '2026-05', 5)] },
    }));

    const result = await getHistory(7, { readCached: () => undefined });

    expect(sentUrl(0)).toMatch(/\/api\/people\/7\/history\/sync$/);
    expect(global.fetch.mock.calls[0][1].method).toBe('POST');
    expect(sentHave(0)).toEqual({});
    expect(flattenHistory(result).map((s) => s.id)).toEqual([2, 1]);
  });

  it('sends the fingerprint of every month it holds, and keeps each month the server did not resend', async () => {
    const june = { fp: 'a', sessions: [session(2, '2026-06', 5)] };
    const may = { fp: 'b', sessions: [session(1, '2026-05', 5)] };
    const cached = synced({ '2026-06': june, '2026-05': may });
    const newJune = { fp: 'a2', sessions: [session(2, '2026-06', 6)] };
    global.fetch.mockResolvedValueOnce(reply(['2026-06', '2026-05'], { '2026-06': newJune }));

    const result = await getHistory(7, { readCached: () => cached });

    expect(sentHave(0)).toEqual({ '2026-06': 'a', '2026-05': 'b' });
    expect(result.months['2026-06']).toEqual(newJune);
    expect(result.months['2026-05']).toBe(may);   // the very object held -- no copy, no refetch
    expect(result.fullSyncedAt).toBe(cached.fullSyncedAt);
  });

  // ── Scoped syncs: after a write on this device, only the touched workout's months ────────────

  const scopedReply = (scope, months, changed = {}) =>
    new Response(JSON.stringify({ months, changed, scope }), { status: 200, headers: { 'content-type': 'application/json' } });
  const sentBody = (call) => JSON.parse(global.fetch.mock.calls[call][1].body);

  it('sends the scope beside everything it holds, and changes only the months the reply scopes', async () => {
    const june = { fp: 'a', sessions: [session(2, '2026-06', 5)] };
    const march = { fp: 'c', sessions: [session(1, '2026-03', 5)] };
    const held = synced({ '2026-06': june, '2026-03': march });
    global.fetch.mockResolvedValueOnce(scopedReply(['2026-06'], ['2026-06'], {
      '2026-06': { fp: 'a2', sessions: [session(2, '2026-06', 8)] },
    }));

    const result = await getHistory(7, {
      readCached: () => held,
      scope: { sessions: [2], at: ['2026-06-12T12:00:00Z'] },
    });

    expect(sentBody(0)).toEqual({ have: { '2026-06': 'a', '2026-03': 'c' }, sessions: [2], at: ['2026-06-12T12:00:00Z'] });
    expect(result.months['2026-06'].fp).toBe('a2');
    // Outside the scope: exactly what was held -- the same object, not a copy.
    expect(result.months['2026-03']).toBe(march);
    expect(result.fullSyncedAt).toBe(held.fullSyncedAt);
  });

  it('drops a scoped month the reply no longer lists, and only that one', async () => {
    const may = { fp: 'b', sessions: [session(1, '2026-05', 5)] };
    const march = { fp: 'c', sessions: [session(3, '2026-03', 5)] };
    global.fetch.mockResolvedValueOnce(scopedReply(['2026-05', '2026-03'], ['2026-03'], {
      '2026-03': { fp: 'c2', sessions: [session(3, '2026-03', 5), session(1, '2026-03', 5)] },
    }));

    const result = await getHistory(7, {
      readCached: () => synced({ '2026-05': may, '2026-03': march }),
      scope: { sessions: [1], at: ['2026-05-11T12:00:00Z'] },
    });

    // A workout moved from May to March elsewhere: May is gone, March holds it.
    expect(Object.keys(result.months)).toEqual(['2026-03']);
    expect(result.months['2026-03'].fp).toBe('c2');
  });

  it('ignores the scope when it holds nothing, so a new device still gets everything', async () => {
    global.fetch.mockResolvedValueOnce(reply(['2026-06'], { '2026-06': { fp: 'a', sessions: [session(2, '2026-06', 5)] } }));

    await getHistory(7, { readCached: () => undefined, scope: { sessions: [2], at: [] } });

    expect(sentBody(0)).toEqual({ have: {} });
  });

  it('applies an unscoped reply as the complete list even when it asked for a scope', async () => {
    // A server that predates scoped syncs answers without `scope`: that is an ordinary reply, and a
    // held month it does not list is gone.
    const june = { fp: 'a', sessions: [session(2, '2026-06', 5)] };
    global.fetch.mockResolvedValueOnce(reply(['2026-06']));

    const result = await getHistory(7, {
      readCached: () => synced({ '2026-06': june, '2026-03': { fp: 'c', sessions: [] } }),
      scope: { sessions: [2], at: [] },
    });

    expect(Object.keys(result.months)).toEqual(['2026-06']);
  });

  it('drops a held month the server no longer lists', async () => {
    const cached = synced({
      '2026-06': { fp: 'a', sessions: [session(2, '2026-06', 5)] },
      '2026-03': { fp: 'c', sessions: [session(1, '2026-03', 5)] },
    });
    global.fetch.mockResolvedValueOnce(reply(['2026-06']));

    const result = await getHistory(7, { readCached: () => cached });

    expect(Object.keys(result.months)).toEqual(['2026-06']);
  });

  // A server bug, but the one that would silently lose a month if it were tolerated.
  it('rejects a reply that lists a month it neither sent nor that is held, rather than drop it', async () => {
    global.fetch.mockResolvedValueOnce(reply(['2026-06', '2026-05'], { '2026-06': { fp: 'a', sessions: [] } }));

    await expect(getHistory(7, { readCached: () => undefined })).rejects.toThrow(/2026-05/);
  });

  // A device upgrading from a build that cached History as one flat array has nothing to offer the
  // sync, so it asks for everything -- and until then the array itself stays readable.
  it('treats a cached plain array from an older build as holding nothing', async () => {
    global.fetch.mockResolvedValueOnce(reply(['2026-06'], { '2026-06': { fp: 'a', sessions: [session(1, '2026-06', 5)] } }));

    const result = await getHistory(7, { readCached: () => [session(1, '2026-06', 5)] });

    expect(sentHave(0)).toEqual({});
    expect(result.format).toBe(HISTORY_FORMAT);
  });

  it('asks for everything once a day, whatever it holds, and restarts the clock', async () => {
    vi.useFakeTimers({ now: new Date('2026-06-15T12:00:00Z') });
    const cached = synced({ '2026-06': { fp: 'a', sessions: [] } }, Date.now() - FULL_SYNC_INTERVAL_MS - 1);
    global.fetch.mockResolvedValueOnce(reply(['2026-06'], { '2026-06': { fp: 'a', sessions: [] } }));

    const result = await getHistory(7, { readCached: () => cached });

    expect(sentHave(0)).toEqual({});
    expect(result.fullSyncedAt).toBe(Date.now());
  });

  // The production canary: the daily full sync re-reads months the device had been trusting, and one
  // whose fingerprint matched while its content did not is reported -- month ids only.
  it('reports a month whose fingerprint matched but whose content did not, on the daily full sync', async () => {
    vi.useFakeTimers({ now: new Date('2026-06-15T12:00:00Z') });
    const cached = synced({ '2026-06': { fp: 'a', sessions: [session(1, '2026-06', 5)] } }, Date.now() - FULL_SYNC_INTERVAL_MS - 1);
    global.fetch
      .mockResolvedValueOnce(reply(['2026-06'], { '2026-06': { fp: 'a', sessions: [session(1, '2026-06', 6)] } }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    await getHistory(7, { readCached: () => cached });

    await vi.waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2));
    expect(sentUrl(1)).toMatch(/\/api\/people\/7\/history\/drift$/);
    expect(JSON.parse(global.fetch.mock.calls[1][1].body)).toEqual({ months: ['2026-06'] });
  });

  it('reports nothing when the full sync finds every trusted month exactly as held', async () => {
    vi.useFakeTimers({ now: new Date('2026-06-15T12:00:00Z') });
    const june = { fp: 'a', sessions: [session(1, '2026-06', 5)] };
    const cached = synced({ '2026-06': june }, Date.now() - FULL_SYNC_INTERVAL_MS - 1);
    global.fetch.mockResolvedValueOnce(reply(['2026-06'], { '2026-06': june }));

    await getHistory(7, { readCached: () => cached });

    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('never lets a failed drift report fail the sync that found it', async () => {
    vi.useFakeTimers({ now: new Date('2026-06-15T12:00:00Z') });
    const cached = synced({ '2026-06': { fp: 'a', sessions: [session(1, '2026-06', 5)] } }, Date.now() - FULL_SYNC_INTERVAL_MS - 1);
    global.fetch
      .mockResolvedValueOnce(reply(['2026-06'], { '2026-06': { fp: 'a', sessions: [session(1, '2026-06', 6)] } }))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'));

    const result = await getHistory(7, { readCached: () => cached });

    expect(flattenHistory(result)[0].entries[0].sets[0].reps).toBe(6);
  });

  it('does not force a full sync before the day is up', async () => {
    vi.useFakeTimers({ now: new Date('2026-06-15T12:00:00Z') });
    const cached = synced({ '2026-06': { fp: 'a', sessions: [] } }, Date.now() - FULL_SYNC_INTERVAL_MS + 60_000);
    global.fetch.mockResolvedValueOnce(reply(['2026-06']));

    await getHistory(7, { readCached: () => cached });

    expect(sentHave(0)).toEqual({ '2026-06': 'a' });
  });
});

// The same, as the app actually runs it: a query whose cached value is what the NEXT sync sends.
describe('getHistory through a real QueryClient', () => {
  let client;
  const key = queryKeys.history(7);
  const fetchHistory = () =>
    client.fetchQuery({ queryKey: key, queryFn: () => getHistory(7, { readCached: () => client.getQueryData(key) }), staleTime: 0 });

  beforeEach(() => {
    setAuthToken('t');
    global.fetch = vi.fn();
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  });

  afterEach(() => {
    client.clear();
    vi.restoreAllMocks();
  });

  it('sends back the fingerprints it was given, and an unchanged month survives by identity', async () => {
    const may = { fp: 'b', sessions: [session(1, '2026-05', 5)] };
    global.fetch.mockResolvedValueOnce(reply(['2026-06', '2026-05'], {
      '2026-06': { fp: 'a', sessions: [session(2, '2026-06', 5)] },
      '2026-05': may,
    }));
    await fetchHistory();
    const mayHeld = client.getQueryData(key).months['2026-05'];

    global.fetch.mockResolvedValueOnce(reply(['2026-06', '2026-05'], {
      '2026-06': { fp: 'a2', sessions: [session(2, '2026-06', 6), session(3, '2026-06', 5)] },
    }));
    await fetchHistory();

    expect(sentHave(1)).toEqual({ '2026-06': 'a', '2026-05': 'b' });
    expect(client.getQueryData(key).months['2026-05']).toBe(mayHeld);
    expect(flattenHistory(client.getQueryData(key)).map((s) => s.id)).toEqual([2, 3, 1]);
  });

  // Degraded, a sync simply fails -- and the months already held are what the screen keeps showing.
  it('keeps every held month when a sync fails', async () => {
    global.fetch.mockResolvedValueOnce(reply(['2026-06'], { '2026-06': { fp: 'a', sessions: [session(1, '2026-06', 5)] } }));
    await fetchHistory();
    const before = client.getQueryData(key);

    global.fetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ message: 'down' }), { status: 503, headers: { 'content-type': 'application/json' } }),
    );
    await expect(fetchHistory()).rejects.toMatchObject({ status: 503 });

    expect(client.getQueryData(key)).toBe(before);
  });
});
