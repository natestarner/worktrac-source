package com.worktrac.backend.user.dto;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record RegisterRequest(
        String accountName,

        @NotBlank @Email String email,

        @NotBlank @Size(min = 8, message = "must be at least 8 characters") String password,

        @NotBlank String personName
) {
}
