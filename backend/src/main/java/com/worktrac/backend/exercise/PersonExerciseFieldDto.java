package com.worktrac.backend.exercise;

public record PersonExerciseFieldDto(Long id, String name, String value, int sortOrder) {

    public static PersonExerciseFieldDto from(PersonExerciseField field) {
        return new PersonExerciseFieldDto(field.getId(), field.getName(), field.getValue(), field.getSortOrder());
    }
}
