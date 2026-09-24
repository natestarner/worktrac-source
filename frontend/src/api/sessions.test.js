import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { getHistory } from './sessions';
import { setAuthToken } from './client';
import { queryKeys } from './queryKeys';
import { registerHistoryQueryDefaults } from '../lib/queryClient';

// History's conditional fetch. The property every test here protects: a 304 is only ever turned
// into data the device ALREADY holds for exactly that tag. Anything else -- no tag, a copy the tag
// doesn't belong to, a cache that changed mid-request -- is a full download.

function historyResponse(body, etag) {
  const headers = { 'content-type': 'application/json' };
  if (etag) headers.ETag = etag;
  return new Response(JSON.stringify(body), { status: 200, headers });
}

const notModified = () => new Response(null, { status: 304 });
const sentTag = (call) => global.fetch.mock.calls[call][1].headers['If-None-Match'];

const session = (id, reps) => ({ id, startedAt: `2026-09-0${id}T12:00:00Z`, entries: [{ exerciseId: 1, sets: [{ weight: 100, reps }] }] });

describe('getHistory', () => {
  beforeEach(() => {
    setAuthToken('t');
    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sends no tag when nothing is cached', async () => {
    global.fetch.mockResolvedValueOnce(historyResponse([session(1, 5)], 'W/"a"'));

    await expect(getHistory(7, { readCached: () => undefined })).resolves.toEqual([session(1, 5)]);
    expect(sentTag(0)).toBeUndefined();
  });

  it('sends the tag of the cached copy and returns that same copy on a 304', async () => {
    global.fetch.mockResolvedValueOnce(historyResponse([session(1, 5)], 'W/"a"'));
    const cached = await getHistory(7);

    global.fetch.mockResolvedValueOnce(notModified());
    const again = await getHistory(7, { readCached: () => cached });

    expect(sentTag(1)).toBe('W/"a"');
    expect(again).toBe(cached);
  });

  it('returns the new history on a 200, never the cached copy', async () => {
    global.fetch.mockResolvedValueOnce(historyResponse([session(1, 5)], 'W/"a"'));
    const cached = await getHistory(7);

    global.fetch.mockResolvedValueOnce(historyResponse([session(2, 8), session(1, 5)], 'W/"b"'));
    const fresh = await getHistory(7, { readCached: () => cached });

    expect(fresh).toEqual([session(2, 8), session(1, 5)]);
  });

  it('never sends a tag for a copy that did not come from a tagged response (a restored cache)', async () => {
    // Deep-equal to a tagged response, but a different object -- exactly what hydrating the
    // persisted cache after a reload produces. Its content is unverified, so it gets no tag.
    global.fetch.mockResolvedValueOnce(historyResponse([session(1, 5)], 'W/"a"'));
    await getHistory(7);
    const restored = [session(1, 5)];

    global.fetch.mockResolvedValueOnce(historyResponse([session(1, 5)], 'W/"a"'));
    await getHistory(7, { readCached: () => restored });

    expect(sentTag(1)).toBeUndefined();
  });

  it('sends no tag when the response carried none', async () => {
    global.fetch.mockResolvedValueOnce(historyResponse([session(1, 5)], null));
    const cached = await getHistory(7);

    global.fetch.mockResolvedValueOnce(historyResponse([session(1, 5)], null));
    await getHistory(7, { readCached: () => cached });

    expect(sentTag(1)).toBeUndefined();
  });

  it('refetches in full when the cache changed while a conditional request was out', async () => {
    global.fetch.mockResolvedValueOnce(historyResponse([session(1, 5)], 'W/"a"'));
    const cached = await getHistory(7);
    const replacement = [session(3, 1)];
    let current = cached;

    global.fetch.mockImplementationOnce(() => {
      current = replacement; // something replaced the cached copy mid-flight
      return Promise.resolve(notModified());
    });
    global.fetch.mockResolvedValueOnce(historyResponse([session(2, 8)], 'W/"c"'));

    const result = await getHistory(7, { readCached: () => current });

    expect(result).toEqual([session(2, 8)]);
    expect(result).not.toBe(cached);
    expect(sentTag(2)).toBeUndefined();
  });

  it('fails exactly like an ordinary fetch when the server is down', async () => {
    global.fetch.mockResolvedValueOnce(historyResponse([session(1, 5)], 'W/"a"'));
    const cached = await getHistory(7);

    global.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ message: 'down' }), { status: 503, headers: { 'content-type': 'application/json' } }));

    await expect(getHistory(7, { readCached: () => cached })).rejects.toMatchObject({ status: 503 });
  });
});

// The same flow through a real QueryClient, because TanStack's structural sharing STORES a merge of
// old and new rather than the object getHistory returned. Without registerHistoryQueryDefaults the
// tag would be stranded on the returned object and every fetch after a change would silently go
// back to a full download. With it, the stored merge carries the tag -- and the 304 hands back that
// exact stored object, so nothing downstream even sees a change.
describe('getHistory through the query cache', () => {
  let client;

  beforeEach(() => {
    setAuthToken('t');
    global.fetch = vi.fn();
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    registerHistoryQueryDefaults(client);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    client.clear();
  });

  const fetchHistory = () =>
    client.fetchQuery({
      queryKey: queryKeys.history(7),
      queryFn: () => getHistory(7, { readCached: () => client.getQueryData(queryKeys.history(7)) }),
      staleTime: 0,
    });

  it('keeps the tag across a partial change, then serves the stored copy on a 304', async () => {
    global.fetch.mockResolvedValueOnce(historyResponse([session(1, 5)], 'W/"a"'));
    await fetchHistory();

    // A new session: the merge keeps session 1's object but is a new array.
    global.fetch.mockResolvedValueOnce(historyResponse([session(2, 8), session(1, 5)], 'W/"b"'));
    await fetchHistory();
    const stored = client.getQueryData(queryKeys.history(7));
    expect(stored).toEqual([session(2, 8), session(1, 5)]);

    global.fetch.mockResolvedValueOnce(notModified());
    const afterNotModified = await fetchHistory();

    expect(sentTag(1)).toBe('W/"a"');
    expect(sentTag(2)).toBe('W/"b"');
    expect(afterNotModified).toBe(stored);
    expect(client.getQueryData(queryKeys.history(7))).toBe(stored);
  });

  it('keeps each person on their own tag', async () => {
    global.fetch.mockResolvedValueOnce(historyResponse([session(1, 5)], 'W/"seven"'));
    await fetchHistory();

    global.fetch.mockResolvedValueOnce(historyResponse([session(4, 2)], 'W/"eight"'));
    await client.fetchQuery({
      queryKey: queryKeys.history(8),
      queryFn: () => getHistory(8, { readCached: () => client.getQueryData(queryKeys.history(8)) }),
    });

    expect(sentTag(1)).toBeUndefined();
  });

  it('starts over with a full fetch after the cache is cleared (sign-out, account switch)', async () => {
    global.fetch.mockResolvedValueOnce(historyResponse([session(1, 5)], 'W/"a"'));
    await fetchHistory();
    client.clear();

    global.fetch.mockResolvedValueOnce(historyResponse([session(1, 5)], 'W/"a"'));
    await fetchHistory();

    expect(sentTag(1)).toBeUndefined();
  });
});
