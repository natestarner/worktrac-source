package com.worktrac.backend.exercise;

import java.util.List;

// Setting the household tags applied to an exercise for a person. Tag names are free-text and
// upserted into the account's shared vocabulary (see TagService.getOrCreate). An empty or
// absent list clears the person's tags on that exercise.
public record ExerciseTagsRequest(List<String> tags) {
    public List<String> tagsOrEmpty() {
        return tags == null ? List.of() : tags;
    }
}
