package com.worktrac.backend.routine;

import jakarta.validation.constraints.NotEmpty;

import java.util.List;
import jakarta.validation.constraints.Size;

// The person's routines, in the order they want them. Ordered and COMPLETE: RoutineService
// requires the set to match that person's routines exactly, so a partial list is a 400 rather
// than a silent renumbering that leaves the omitted routines at an arbitrary position.
//
// The cap matches routines-per-person (QuotaProperties), so a well-formed list can always be
// sent even by a household sitting on the quota.
public record ReorderRoutinesRequest(
        @NotEmpty @Size(max = 100, message = "cannot reorder more than 100 routines at once")
        List<Long> routineIds) {
}
