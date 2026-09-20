package com.worktrac.backend.stats;

import java.math.BigDecimal;

// One line of the breakdown behind a SESSION-level record on the PRs board: what was actually
// lifted in the session that set it.
//
// `count` collapses consecutive identical sets, so eight sets of 135x10 serialise as one entry
// with count 8 rather than eight rows. That is what keeps the payload small enough to ride on a
// board that lists every exercise, and it is also how a person reads their own workout -- "4 x
// 135x10", not four separate lines.
//
// Weights are POUNDS, like every other field on PrMeasureDto; the client converts to the
// household's unit when it renders.
//
// This exists because "One session" was the whole caption for the Volume and Reps records. The
// number was unreadable on its own -- there was no way to tell a genuine heavy day from ten junk
// sets of an empty bar, which is exactly the thing a volume record can be gamed with. Showing the
// work makes the record self-policing.
public record PrSetDto(BigDecimal weightLb, int reps, Integer durationSeconds, int count) {
}
