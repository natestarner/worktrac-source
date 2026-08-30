package com.worktrac.backend.exercise;

import jakarta.validation.constraints.Size;

import java.util.List;

// Setting the household tags applied to an exercise for a person. Tag names are free-text and
// upserted into the account's shared vocabulary (see TagService.getOrCreate). An empty or
// absent list clears the person's tags on that exercise.
// Both caps matter, and for different reasons. The element cap keeps a name that cannot fit
// tags.name (NVARCHAR(100)) from ever reaching the insert. The LIST cap is the abuse control:
// PersonExerciseService.setTags calls TagService.getOrCreate once per entry, each a lookup plus a
// possible insert into the household's shared vocabulary, so an uncapped list turned one request
// into unbounded database work inside a single transaction -- against a Hikari pool of 10.
public record ExerciseTagsRequest(
        @Size(max = 50, message = "cannot apply more than 50 tags at once")
        List<@Size(max = 100, message = "must be 100 characters or fewer") String> tags) {
    public List<String> tagsOrEmpty() {
        return tags == null ? List.of() : tags;
    }
}
