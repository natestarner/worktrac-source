// The rest timer's target, and the seam the configurable per-person / per-exercise targets will
// hang off later.
//
// Neither optional field read below is backed by a column yet, so this returns the default for
// everyone today. It exists anyway because the alternative -- a bare `90` at the call site -- is
// exactly what makes adding those columns a hunt through the codebase. Every consumer already reads
// a SNAPSHOTTED `targetSeconds` off the timer itself (see UIContext), never re-derives one, so
// adding the real targets is a change to this function plus the two write surfaces and nothing else.

export const DEFAULT_REST_TARGET_SECONDS = 90;

// Counting UP has no natural end, unlike the old countdown's self-destruct at zero. Without a
// ceiling a timer left running overnight keeps climbing -- and, worse, keeps UIContext's 200ms
// ticker alive forever to do it. At the ceiling the value freezes and the entry is marked `capped`,
// which is what lets the interval stop while the filled ring stays lit (that person still hasn't
// gone). 10 minutes is well past any real rest interval and comfortably inside "they wandered off".
export const REST_CEILING_SECONDS = 600;

// Resolution order: per-exercise override, else the person's default, else the app default.
// `null`/absent means "inherit", which is why this is a `??` chain and nothing is ever seeded.
export function resolveRestTargetSeconds({ personExercise, person } = {}) {
  return personExercise?.restTargetSeconds ?? person?.restTargetSeconds ?? DEFAULT_REST_TARGET_SECONDS;
}

// Whether a rest timer started at `startedAt` is already past the ceiling, i.e. must be DISCARDED
// rather than resumed. Close the app Friday, reopen Monday, and a naive resume computes three days
// of elapsed and lights the ring for a workout that ended before the weekend. Exported so the
// resume path and the timer itself apply one rule rather than two copies of it.
export function isRestTimerExpired(startedAt) {
  return !startedAt || Date.now() - startedAt >= REST_CEILING_SECONDS * 1000;
}
