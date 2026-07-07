package com.worktrac.backend.person;

import jakarta.validation.constraints.NotBlank;

public record AddPersonRequest(@NotBlank String name) {
}
