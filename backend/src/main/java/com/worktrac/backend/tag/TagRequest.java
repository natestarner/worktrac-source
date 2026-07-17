package com.worktrac.backend.tag;

import jakarta.validation.constraints.NotBlank;

public record TagRequest(@NotBlank String name) {
}
