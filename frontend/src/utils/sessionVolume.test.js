import { describe, expect, it } from 'vitest';
import shared from '../../../shared/record-rules/session-volume-cases.json';
import {
  crossesSessionVolume,
  formatVolume,
  mergeVolumeKinds,
  priorSessionVolume,
  sessionVolume,
  takesSessionVolumeRecord,
  volumeKindOf,
} from './sessionVolume';

// The shared cases are the contract with SessionVolumeTest.java -- the same file, run by both
// suites. Anything added here that is a RULE (rather than a client-only concern like formatting or
// the summary translation) belongs in that file instead, or the server can drift from it.
describe('the shared session-volume rule', () => {
  for (const c of shared.cases) {
    it(c.name, () => {
      const all = c.sessions.flat();
      const kind = volumeKindOf(all);
      expect(kind).toBe(c.expected.kind);

      const volumes = c.sessions.map((sets) => sessionVolume(sets, kind));
      expect(volumes).toHaveLength(c.expected.sessionVolumes.length);
      volumes.forEach((v, i) => expect(v).toBeCloseTo(c.expected.sessionVolumes[i], 2));

      let best = null;
      const records = volumes.map((v) => {
        const took = takesSessionVolumeRecord(v, best);
        best = best == null ? v : Math.max(best, v);
        return took;
      });
      expect(records).toEqual(c.expected.records);
    });
  }
});

describe('mergeVolumeKinds', () => {
  it('equals the kind of the union of both set lists', () => {
    const lists = {
      none: [],
      unloaded: [{ weight: 0, reps: 5 }],
      loaded: [{ weight: 20, reps: 5 }],
      hold: [{ weight: 0, reps: 0, durationSeconds: 30 }],
    };
    for (const a of Object.values(lists)) {
      for (const b of Object.values(lists)) {
        expect(mergeVolumeKinds(volumeKindOf(a), volumeKindOf(b))).toBe(volumeKindOf([...a, ...b]));
      }
    }
  });
});

describe('crossesSessionVolume', () => {
  it('fires once, on the set that passes the prior best', () => {
    expect(crossesSessionVolume(900, 1100, 1000)).toBe(true);
    expect(crossesSessionVolume(1100, 1300, 1000)).toBe(false);
    expect(crossesSessionVolume(500, 900, 1000)).toBe(false);
  });

  it('never fires with no earlier session, however big the first workout is', () => {
    expect(crossesSessionVolume(0, 5000, null)).toBe(false);
    expect(crossesSessionVolume(0, 5000, undefined)).toBe(false);
  });

  it('fires against a real prior of zero', () => {
    expect(crossesSessionVolume(0, 50, 0)).toBe(true);
  });

  it('never fires on a total of zero, or on junk', () => {
    expect(crossesSessionVolume(0, 0, 0)).toBe(false);
    expect(crossesSessionVolume(NaN, 100, 50)).toBe(false);
    expect(crossesSessionVolume(0, NaN, 50)).toBe(false);
  });

  // The claim the feature makes, asserted in the shape a person experiences it: stateless and
  // keyed on nothing, so it holds offline where there is no session id to key a flag on.
  it('fires exactly once across a whole workout of climbing sets', () => {
    let running = 0;
    let fired = 0;
    for (const set of [300, 300, 300, 300, 300, 300]) {
      const before = running;
      running += set;
      if (crossesSessionVolume(before, running, 1000)) fired += 1;
    }
    expect(fired).toBe(1);
  });
});

describe('priorSessionVolume', () => {
  it('reads the summary in its own kind', () => {
    expect(priorSessionVolume({ volumeKind: 'reps', bestSessionVolume: 24 }, 'reps')).toBe(24);
    expect(priorSessionVolume({ volumeKind: 'seconds', bestSessionVolume: 120 }, 'seconds')).toBe(120);
    expect(priorSessionVolume({ volumeKind: 'load', bestSessionVolume: '2400.0' }, 'load')).toBe(2400);
  });

  it('keeps "no earlier session" as null', () => {
    expect(priorSessionVolume({ volumeKind: null, bestSessionVolume: null }, 'reps')).toBeNull();
    expect(priorSessionVolume({ volumeKind: 'reps', bestSessionVolume: null }, 'load')).toBeNull();
  });

  // Every earlier set was unloaded, so every earlier session is exactly 0 lb.
  it('re-reads an all-unloaded history as 0 lb once today adds load', () => {
    expect(priorSessionVolume({ volumeKind: 'reps', bestSessionVolume: 30 }, 'load')).toBe(0);
  });

  it('refuses to compare across kinds it cannot translate', () => {
    expect(priorSessionVolume({ volumeKind: 'load', bestSessionVolume: 2000 }, 'reps')).toBeNull();
    expect(priorSessionVolume({ volumeKind: 'seconds', bestSessionVolume: 90 }, 'reps')).toBeNull();
  });

  // Resilience axis D: a summary cached before volumeKind existed. Its bestSessionVolumeLb was
  // always pounds, so it answers 'load' exactly and nothing else.
  it('reads a summary cached before the kind existed as pounds only', () => {
    const legacy = { bestSessionVolumeLb: 2000 };
    expect(priorSessionVolume(legacy, 'load')).toBe(2000);
    expect(priorSessionVolume(legacy, 'reps')).toBeNull();
    expect(priorSessionVolume({}, 'load')).toBeNull();
  });
});

describe('formatVolume', () => {
  it('reads in the kind’s own unit', () => {
    expect(formatVolume(2400.4, 'load', 'lb')).toBe('2400 lb');
    expect(formatVolume(2204.62, 'load', 'kg')).toBe('1000 kg');
    expect(formatVolume(24, 'reps', 'lb')).toBe('24 reps');
    expect(formatVolume(1, 'reps', 'lb')).toBe('1 rep');
    expect(formatVolume(125, 'seconds', 'kg')).toBe('2:05');
  });
});
