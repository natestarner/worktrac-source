package com.worktrac.backend.routine;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.Size;

import java.util.List;

/**
 * The complete description of a routine — every exercise, in order, with whatever is prescribed.
 *
 * <p>{@code exercises} is ordered: it defines both which exercises belong to the routine and the
 * order stepping through it walks them in.
 *
 * <p>⚠️ It was {@code List<Long> exerciseIds} until targets existed. {@code update} rebuilds the
 * routine from this request, so a shape that could not carry a target would have wiped every target
 * on a routine whenever it was renamed or reordered. <b>This request is the whole truth: a client
 * that reads targets must send them back.</b>
 */
public record RoutineRequest(
        @NotBlank @Size(max = 200, message = "must be 200 characters or fewer") String name,
        @NotEmpty @Size(max = 100, message = "cannot hold more than 100 exercises")
        List<@Valid RoutineExerciseRequest> exercises) {

    /** The ids alone, in order — what exercise resolution and favouriting need. */
    public List<Long> exerciseIds() {
        return exercises.stream().map(RoutineExerciseRequest::exerciseId).toList();
    }
}
