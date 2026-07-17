package com.worktrac.backend.exercise;

import com.worktrac.backend.tag.TagDto;

import java.util.Comparator;
import java.util.List;

// One row of a person's Log picker list -- an exercise they've favorited or logged, carrying
// their personalization (favorite flag + which of the household's shared tags they've applied).
// setupFields are the exercise's shared base fields; a person's own custom fields are fetched
// separately (GET .../custom-fields) since they carry per-person values.
public record PersonExerciseDto(
        Long id,
        String name,
        String trackingType,
        boolean isGlobal,
        boolean isFavorite,
        List<TagDto> tags,
        List<ExerciseSetupFieldDto> setupFields
) {
    public static PersonExerciseDto of(Exercise exercise, PersonExercise personExercise) {
        boolean favorite = personExercise != null && personExercise.isFavorite();
        List<TagDto> tags = personExercise == null ? List.of()
                : personExercise.getTags().stream()
                        .map(TagDto::from)
                        .sorted(Comparator.comparing(TagDto::name, String.CASE_INSENSITIVE_ORDER))
                        .toList();
        return new PersonExerciseDto(
                exercise.getId(),
                exercise.getName(),
                exercise.getTrackingType(),
                exercise.isGlobal(),
                favorite,
                tags,
                exercise.getSetupFields().stream().map(ExerciseSetupFieldDto::from).toList());
    }
}
