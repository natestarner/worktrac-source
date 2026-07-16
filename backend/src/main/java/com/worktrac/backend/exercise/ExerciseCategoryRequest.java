package com.worktrac.backend.exercise;

// Filing an exercise into one of the person's own categories. A null id means "uncategorized".
public record ExerciseCategoryRequest(Long personCategoryId) {
}
