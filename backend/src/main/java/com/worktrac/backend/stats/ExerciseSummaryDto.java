package com.worktrac.backend.stats;

import java.math.BigDecimal;

// What the Log screen knows about one person + exercise before they log their next set.
//
// lastSession and best are both nullable: no lastSession means this person has never logged this
// exercise before (excluding the session in view); no best means never logged at all.
//
// heaviestWeightLb and bestSessionVolumeLb are the prior bests the CLIENT needs to decide which
// records a set just took (frontend/src/utils/prDetection.js). Detection runs client-side so the
// celebration fires in every connectivity mode rather than only when the server's response
// arrives -- see that file's header. Both are normalized to POUNDS, because they are ranked
// against a set that may have been entered in either unit.
//
// ⚠️ THE THREE BESTS EXCLUDE THE CURRENT SESSION DIFFERENTLY, and the asymmetry is load-bearing:
//
//   best, heaviestWeightLb   all-time, INCLUDING the session in view. A set-level PR asks "did
//                            this set beat everything before it", and sets logged earlier in
//                            today's workout are before it. This matches
//                            WorkoutSetService#insertSetAndDetectPr, which reads the best BEFORE
//                            inserting and does not exclude anything.
//   bestSessionVolumeLb      EXCLUDES excludeSessionId. The current session's running total is
//                            the thing being tested against this number, so including it makes
//                            the record chase itself: the moment the running total passes the
//                            record it BECOMES the record, "have I crossed it" goes true again,
//                            and every subsequent set re-fires the celebration.
//
// frontend/src/utils/exerciseSummaryFromHistory.js mirrors both rules for the offline fallback,
// excluding by start time rather than by id (offline there is no session id yet).
//
// Both are null when there is nothing to report, never 0 -- prDetection reads null as "no prior
// best on this measure" and 0 as a real record of zero, which are different answers for a
// bodyweight lift.
public record ExerciseSummaryDto(LastSessionDto lastSession, BestDto best,
                                 BigDecimal heaviestWeightLb, BigDecimal bestSessionVolumeLb) {
}
