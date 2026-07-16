package com.worktrac.backend.personcategory;

import jakarta.validation.constraints.NotBlank;

public record PersonCategoryRequest(@NotBlank String name) {
}
