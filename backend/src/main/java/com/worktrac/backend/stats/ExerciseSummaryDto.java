package com.worktrac.backend.stats;

import java.math.BigDecimal;

// What the Log screen knows about one person + exercise before they log their next set.
//
// lastSession and best are both nullable: no lastSession means this person has never logged this
// exercise before (excluding the session in view); no best means never logged at all.
//
// heaviestWeightLb and bestSessionVolume are the prior bests the CLIENT needs to decide which
// records a set just took (frontend/src/utils/prDetection.js, sessionVolume.js). Detection runs
// client-side so the celebration fires in every connectivity mode rather than only when the
// server's response arrives -- see prDetection.js's header. heaviestWeightLb is POUNDS, because
// it is ranked against a set that may have been entered in either unit, and both it and
// bestSessionVolume are UNROUNDED: they are thresholds the client compares its own exact figures
// against (SetMeasures / formulas.js#weightLb), so rounding them to 0.1 would make the online
// answer disagree with the offline fallback's, which derives the same numbers without rounding.
//
// bestSessionVolume is in the exercise's own volume measure, which volumeKind names ("load" =
// pounds, "reps", "seconds" -- see SessionVolume). The kind travels WITH the number so the client
// never has to guess the unit of a figure it did not compute. volumeKind is decided over every set
// including the excluded session's (it is a property of the exercise); it is null only when
// nothing has ever been logged.
//
// bestSessionVolumeLb is the pre-kinds field, kept so a client built before this shipped (a
// service-worker-cached bundle mid-deploy) still reads the weight x reps figure it expects rather
// than `undefined` -- which it would treat as "no prior" and celebrate every workout's first set.
// New code reads bestSessionVolume + volumeKind; drop this once no such bundle can be alive.
//
// ⚠️ THE THREE BESTS EXCLUDE THE CURRENT SESSION DIFFERENTLY, and the asymmetry is load-bearing:
//
//   best, heaviestWeightLb   all-time, INCLUDING the session in view. A set-level PR asks "did
//                            this set beat everything before it", and sets logged earlier in
//                            today's workout are before it. This matches
//                            WorkoutSetService#insertSetAndDetectPr, which reads the best BEFORE
//                            inserting and does not exclude anything.
//   bestSessionVolume        EXCLUDES excludeSessionId. The current session's running total is
//                            the thing being tested against this number, so including it makes
//                            the record chase itself: the moment the running total passes the
//                            record it BECOMES the record, "have I crossed it" goes true again,
//                            and every subsequent set re-fires the celebration.
//
// frontend/src/utils/exerciseSummaryFromHistory.js mirrors both rules for the offline fallback,
// excluding by start time rather than by id (offline there is no session id yet).
//
// The bests are null when there is nothing to report, never 0 -- the client reads null as "no
// prior best on this measure" and 0 as a real record of zero. For session volume that difference
// is the first-workout rule: null (no earlier session) never celebrates.
public record ExerciseSummaryDto(LastSessionDto lastSession, BestDto best,
                                 BigDecimal heaviestWeightLb, BigDecimal bestSessionVolume, String volumeKind,
                                 BigDecimal bestSessionVolumeLb) {
}
