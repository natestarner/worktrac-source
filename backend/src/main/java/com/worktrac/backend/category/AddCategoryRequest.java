package com.worktrac.backend.category;

import jakarta.validation.constraints.NotBlank;

public record AddCategoryRequest(@NotBlank String name) {
}
