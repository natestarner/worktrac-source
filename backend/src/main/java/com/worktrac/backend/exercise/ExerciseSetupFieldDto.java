package com.worktrac.backend.exercise;

public record ExerciseSetupFieldDto(Long id, String name) {

    public static ExerciseSetupFieldDto from(ExerciseSetupField field) {
        return new ExerciseSetupFieldDto(field.getId(), field.getName());
    }
}
