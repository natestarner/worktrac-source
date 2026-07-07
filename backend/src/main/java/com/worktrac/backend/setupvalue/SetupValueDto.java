package com.worktrac.backend.setupvalue;

import com.worktrac.backend.exercise.ExerciseSetupField;

public record SetupValueDto(Long fieldId, String fieldName, String value) {

    public static SetupValueDto empty(ExerciseSetupField field) {
        return new SetupValueDto(field.getId(), field.getName(), "");
    }

    public static SetupValueDto from(SetupValue setupValue) {
        return new SetupValueDto(setupValue.getField().getId(), setupValue.getField().getName(), setupValue.getValue());
    }
}
