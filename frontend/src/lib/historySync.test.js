import { describe, expect, it } from 'vitest';
import {
  HISTORY_FORMAT,
  applyHistorySync,
  auditFor,
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

  // A sync that only re-read a month and found it unchanged must not make every screen re-derive
  // records from the whole History: same `months`, same array.
  it('hands back the same array while the months are the same object', () => {
    const months = { '2026-06': { fp: 'a', sessions: [s(1, '2026-06-02')] } };
    const first = flattenHistory({ ...synced(months), checked: { '2026-06': 1 } });
    const again = flattenHistory({ ...synced(months), checked: { '2026-06': 2 } });

    expect(again).toBe(first);
    expect(flattenHistory(synced({ ...months }))).not.toBe(first);
  });
});

describe('heldForSync', () => {
  it('offers nothing for nothing cached, a legacy array, or an unknown shape', () => {
    expect(heldForSync(undefined)).toBeNull();
    expect(heldForSync([s(1, '2026-06-02')])).toBeNull();
    expect(heldForSync({ format: 1, months: {} })).toBeNull();
  });

  // No periodic full download any more: however long ago the last one was, the held months are
  // offered, and the rolling check (auditFor) re-reads them one at a time.
  it('offers the cached months however old the last full download is', () => {
    const cached = synced({}, 1_000);

    expect(heldForSync(cached)).toBe(cached);
    expect(heldForSync(synced({}, Number.NaN))).not.toBeNull();
  });
});

describe('fingerprintsOf', () => {
  it('maps each held month to its fingerprint, and nothing held to nothing', () => {
    expect(fingerprintsOf(synced({ '2026-06': { fp: 'a', sessions: [] }, '2026-05': { fp: 'b', sessions: [] } })))
      .toEqual({ '2026-06': 'a', '2026-05': 'b' });
    expect(fingerprintsOf(null)).toEqual({});
  });
});

describe('auditFor (the rolling check)', () => {
  const months = (...keys) => Object.fromEntries(keys.map((k) => [k, { fp: k, sessions: [] }]));

  it('picks the month re-read longest ago', () => {
    const held = { ...synced(months('2026-06', '2026-05', '2026-04')), checked: { '2026-06': 30, '2026-05': 10, '2026-04': 20 } };

    expect(auditFor(held)).toEqual(['2026-05']);
    expect(auditFor(held, 2)).toEqual(['2026-05', '2026-04']);
  });

  it('picks a month never re-read before any that has been, newest first among them', () => {
    const held = { ...synced(months('2026-06', '2026-05', '2026-04')), checked: { '2026-05': 10 } };

    expect(auditFor(held, 2)).toEqual(['2026-06', '2026-04']);
  });

  it('cycles through every month as each is stamped', () => {
    let held = { ...synced(months('2026-06', '2026-05', '2026-04')), checked: {} };
    const seen = [];
    for (let t = 1; t <= 3; t += 1) {
      const [m] = auditFor(held);
      seen.push(m);
      held = applyHistorySync(held, { months: Object.keys(held.months), changed: {}, audited: { [m]: held.months[m] } }, t);
    }

    expect(seen.sort()).toEqual(['2026-04', '2026-05', '2026-06']);
  });

  it('asks for nothing when nothing is held', () => {
    expect(auditFor(null)).toEqual([]);
    expect(auditFor(synced({}))).toEqual([]);
  });
});

describe('findDrift (the canary)', () => {
  const month = (fp, ids) => ({ fp, sessions: ids.map((id) => s(id, '2026-06-02')) });

  it('names a re-read month whose fingerprint matched but whose content did not', () => {
    const held = synced({ '2026-06': month('a', [1]), '2026-05': month('b', [2]) });

    expect(findDrift(held, { '2026-06': month('a', [1, 9]) }))
      .toEqual(['2026-06']);
  });

  it('is silent for a month that changed honestly (a new fingerprint), and for one that did not change at all', () => {
    const held = synced({ '2026-06': month('a', [1]), '2026-05': month('b', [2]) });

    expect(findDrift(held, { '2026-06': month('a2', [1, 9]), '2026-05': month('b', [2]) })).toEqual([]);
  });

  it('has nothing to compare against when nothing is held, or no month was re-read', () => {
    expect(findDrift(null, { '2026-06': month('a', [1]) })).toEqual([]);
    expect(findDrift(synced({ '2026-06': month('a', [1]) }), undefined)).toEqual([]);
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
    expect(result.fullSyncedAt).toBe(1_000); // a partial sync is not a full download
    expect(result.checked).toEqual({ '2026-06': 9_000 }); // re-read now; May kept as it was
  });

  it('stamps a full sync with the time it happened, every month re-read', () => {
    const result = applyHistorySync(null, { months: ['2026-06'], changed: { '2026-06': { fp: 'a', sessions: [] } } }, 9_000);

    expect(result).toEqual({
      format: HISTORY_FORMAT,
      months: { '2026-06': { fp: 'a', sessions: [] } },
      checked: { '2026-06': 9_000 },
      fullSyncedAt: 9_000,
    });
  });

  it('keeps a re-read month that came back the same by identity, only moving its check time', () => {
    const june = { fp: 'a', sessions: [s(3, '2026-06-02')] };
    const held = { ...synced({ '2026-06': june }), checked: { '2026-06': 5 } };

    const result = applyHistorySync(held, { months: ['2026-06'], changed: {}, audited: { '2026-06': { fp: 'a', sessions: [s(3, '2026-06-02')] } } }, 9_000);

    expect(result.months['2026-06']).toBe(june);
    expect(result.checked['2026-06']).toBe(9_000);
  });

  it("replaces a re-read month that came back different -- drift or not, the server's copy wins", () => {
    const held = synced({ '2026-06': { fp: 'a', sessions: [s(3, '2026-06-02')] } });
    const truth = { fp: 'a', sessions: [s(3, '2026-06-02'), s(4, '2026-06-09')] };

    const result = applyHistorySync(held, { months: ['2026-06'], changed: {}, audited: { '2026-06': truth } }, 9_000);

    expect(result.months['2026-06']).toBe(truth);
  });

  it('ignores a re-read month the reply no longer lists (it is gone)', () => {
    const held = synced({ '2026-06': { fp: 'a', sessions: [] }, '2026-05': { fp: 'b', sessions: [] } });

    const result = applyHistorySync(held, { months: ['2026-06'], changed: {}, audited: { '2026-05': { fp: 'b', sessions: [] } } }, 9_000);

    expect(Object.keys(result.months)).toEqual(['2026-06']);
  });

  it('refuses a listed month that was neither sent nor held', () => {
    expect(() => applyHistorySync(synced({}), { months: ['2026-06'], changed: {} })).toThrow(/2026-06/);
  });
});
