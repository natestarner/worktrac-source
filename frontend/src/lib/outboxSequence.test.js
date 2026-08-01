import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { byEnqueueOrder, nextOutboxSeq, seedOutboxSeq, withEnqueueSeq } from './outboxSequence';

const SEQ_KEY = 'worktrac-outbox-seq';

function mutation(enqueueSeq, submittedAt = 0) {
  return { state: { variables: enqueueSeq === undefined ? {} : { enqueueSeq }, submittedAt } };
}

describe('outboxSequence', () => {
  beforeEach(() => localStorage.removeItem(SEQ_KEY));
  afterEach(() => localStorage.removeItem(SEQ_KEY));

  describe('nextOutboxSeq', () => {
    it('starts at 1 and increments monotonically', () => {
      expect(nextOutboxSeq()).toBe(1);
      expect(nextOutboxSeq()).toBe(2);
      expect(nextOutboxSeq()).toBe(3);
    });

    it('persists across calls that simulate a reload (fresh read of the same storage key)', () => {
      nextOutboxSeq();
      nextOutboxSeq();
      // Nothing to "reload" in-process -- the counter IS the persisted value; the next call reads
      // it back from localStorage rather than any in-memory state.
      expect(nextOutboxSeq()).toBe(3);
    });
  });

  describe('seedOutboxSeq', () => {
    it('bumps the counter forward when the persisted outbox holds a higher seq than localStorage knows about', () => {
      // Simulates: localStorage was cleared but the IndexedDB outbox (a separate store) survived
      // with writes already carrying seq up to 5.
      seedOutboxSeq(6);
      expect(nextOutboxSeq()).toBe(6);
    });

    it('never moves the counter backward', () => {
      nextOutboxSeq(); // 1
      nextOutboxSeq(); // 2
      seedOutboxSeq(1); // lower than current -- must be a no-op
      expect(nextOutboxSeq()).toBe(3);
    });
  });

  describe('withEnqueueSeq', () => {
    it('stamps a fresh seq onto variables with none yet', () => {
      const stamped = withEnqueueSeq({ weight: 100 });
      expect(stamped.enqueueSeq).toBe(1);
      expect(stamped.weight).toBe(100);
    });

    it('preserves an existing seq instead of re-stamping (a restore re-dispatch)', () => {
      const stamped = withEnqueueSeq({ weight: 100, enqueueSeq: 42 });
      expect(stamped.enqueueSeq).toBe(42);
    });

    it('never advances the counter for a write that already carries a seq', () => {
      withEnqueueSeq({ enqueueSeq: 999 });
      // A genuinely new write right after must still get the next real sequence value, not
      // something derived from the preserved 999.
      expect(nextOutboxSeq()).toBe(1);
    });
  });

  describe('byEnqueueOrder', () => {
    it('sorts ascending by enqueueSeq', () => {
      const b = mutation(2);
      const a = mutation(1);
      const c = mutation(3);
      expect([b, c, a].sort(byEnqueueOrder)).toEqual([a, b, c]);
    });

    it('falls back to submittedAt when enqueueSeq is absent on both sides (legacy/raw-dispatch entries)', () => {
      const later = mutation(undefined, 200);
      const earlier = mutation(undefined, 100);
      expect([later, earlier].sort(byEnqueueOrder)).toEqual([earlier, later]);
    });

    it('an entry with no enqueueSeq sorts before one that has it, regardless of submittedAt -- legacy writes are genuinely older', () => {
      const legacy = mutation(undefined, 999999);
      const withSeq = mutation(1, 0);
      expect([withSeq, legacy].sort(byEnqueueOrder)).toEqual([legacy, withSeq]);
    });
  });
});
