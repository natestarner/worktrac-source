package com.worktrac.backend.tag;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record TagRequest(
        @NotBlank @Size(max = 100, message = "must be 100 characters or fewer") String name) {
}
