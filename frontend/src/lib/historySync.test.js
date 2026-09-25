import { describe, expect, it } from 'vitest';
import {
  FULL_SYNC_INTERVAL_MS,
  HISTORY_FORMAT,
  applyHistorySync,
  findDrift,
  fingerprintsOf,
  flattenHistory,
  heldForSync,
} from './historySync';

const s = (id, startedAt) => ({ id, startedAt, entries: [] });
const synced = (months, fullSyncedAt = 1_000) => ({ format: HISTORY_FORMAT, months, fullSyncedAt });

describe('flattenHistory', () => {
  it('returns every session newest month first, each month in the order it was sent', () => {
    const data = synced({
      '2025-12': { fp: 'x', sessions: [s(1, '2025-12-20')] },
      '2026-06': { fp: 'a', sessions: [s(4, '2026-06-20'), s(3, '2026-06-02')] },
      '2026-01': { fp: 'y', sessions: [s(2, '2026-01-05')] },
    });

    expect(flattenHistory(data).map((x) => x.id)).toEqual([4, 3, 2, 1]);
  });

  // A cache persisted by a build that predates the sync. Offline, right after the upgrade, it may be
  // all the device has -- it must still render.
  it('passes a plain array from an older build through untouched', () => {
    const legacy = [s(2, '2026-06-02'), s(1, '2026-05-01')];

    expect(flattenHistory(legacy)).toBe(legacy);
  });

  it('is an empty list for nothing cached, or for a shape it does not recognise', () => {
    expect(flattenHistory(undefined)).toEqual([]);
    expect(flattenHistory(null)).toEqual([]);
    expect(flattenHistory({ format: 99, months: {} })).toEqual([]);
  });

  it('keeps an empty month empty', () => {
    expect(flattenHistory(synced({ '2026-04': { fp: 'e', sessions: [] } }))).toEqual([]);
  });
});

describe('heldForSync', () => {
  it('offers nothing for nothing cached, a legacy array, or an unknown shape', () => {
    expect(heldForSync(undefined, 5_000)).toBeNull();
    expect(heldForSync([s(1, '2026-06-02')], 5_000)).toBeNull();
    expect(heldForSync({ format: 1, months: {} }, 5_000)).toBeNull();
  });

  it('offers the cached months until the daily full sync is due, and nothing from then on', () => {
    const cached = synced({}, 1_000);

    expect(heldForSync(cached, 1_000 + FULL_SYNC_INTERVAL_MS - 1)).toBe(cached);
    expect(heldForSync(cached, 1_000 + FULL_SYNC_INTERVAL_MS)).toBeNull();
  });

  // A clock that jumped backwards, or a missing stamp, must not keep a cache "fresh" forever.
  it('treats a missing, nonsensical or future stamp as due', () => {
    expect(heldForSync({ format: HISTORY_FORMAT, months: {} }, 5_000)).toBeNull();
    expect(heldForSync(synced({}, Number.NaN), 5_000)).toBeNull();
    expect(heldForSync(synced({}, 5_001), 5_000)).toBeNull();
  });
});

describe('fingerprintsOf', () => {
  it('maps each held month to its fingerprint, and nothing held to nothing', () => {
    expect(fingerprintsOf(synced({ '2026-06': { fp: 'a', sessions: [] }, '2026-05': { fp: 'b', sessions: [] } })))
      .toEqual({ '2026-06': 'a', '2026-05': 'b' });
    expect(fingerprintsOf(null)).toEqual({});
  });
});

describe('findDrift', () => {
  const month = (fp, ids) => ({ fp, sessions: ids.map((id) => s(id, '2026-06-02')) });

  it('names a month whose fingerprint matched but whose content did not', () => {
    const cached = synced({ '2026-06': month('a', [1]), '2026-05': month('b', [2]) });

    expect(findDrift(cached, { months: ['2026-06', '2026-05'], changed: { '2026-06': month('a', [1, 9]), '2026-05': month('b', [2]) } }))
      .toEqual(['2026-06']);
  });

  it('is silent for a month that changed honestly (a new fingerprint), and for one that did not change at all', () => {
    const cached = synced({ '2026-06': month('a', [1]), '2026-05': month('b', [2]) });

    expect(findDrift(cached, { months: ['2026-06', '2026-05'], changed: { '2026-06': month('a2', [1, 9]), '2026-05': month('b', [2]) } }))
      .toEqual([]);
  });

  it('has nothing to compare against for a month it did not hold, or a cache from before the sync', () => {
    expect(findDrift(synced({}), { months: ['2026-06'], changed: { '2026-06': month('a', [1]) } })).toEqual([]);
    expect(findDrift([s(1, '2026-06-02')], { months: ['2026-06'], changed: { '2026-06': month('a', [9]) } })).toEqual([]);
  });
});

describe('applyHistorySync', () => {
  it('is exactly the listed months: sent ones replaced, the rest kept by identity, unlisted ones gone', () => {
    const june = { fp: 'a', sessions: [s(3, '2026-06-02')] };
    const may = { fp: 'b', sessions: [s(2, '2026-05-02')] };
    const march = { fp: 'c', sessions: [s(1, '2026-03-02')] };
    const newJune = { fp: 'a2', sessions: [s(3, '2026-06-02'), s(4, '2026-06-09')] };

    const result = applyHistorySync(
      synced({ '2026-06': june, '2026-05': may, '2026-03': march }, 1_000),
      { months: ['2026-06', '2026-05'], changed: { '2026-06': newJune } },
      9_000,
    );

    expect(result.months['2026-06']).toBe(newJune);
    expect(result.months['2026-05']).toBe(may);
    expect(Object.keys(result.months)).toEqual(['2026-06', '2026-05']);
    expect(result.fullSyncedAt).toBe(1_000);   // a partial sync doesn't reset the daily clock
  });

  it('stamps a full sync with the time it happened', () => {
    const result = applyHistorySync(null, { months: ['2026-06'], changed: { '2026-06': { fp: 'a', sessions: [] } } }, 9_000);

    expect(result).toEqual({ format: HISTORY_FORMAT, months: { '2026-06': { fp: 'a', sessions: [] } }, fullSyncedAt: 9_000 });
  });

  it('refuses a listed month that was neither sent nor held', () => {
    expect(() => applyHistorySync(synced({}), { months: ['2026-06'], changed: {} })).toThrow(/2026-06/);
  });
});
