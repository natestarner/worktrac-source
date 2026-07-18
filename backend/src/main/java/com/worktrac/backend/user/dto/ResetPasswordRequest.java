package com.worktrac.backend.user.dto;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

public record ResetPasswordRequest(
        @NotBlank @Email String email,

        @NotBlank @Pattern(regexp = "\\d{6}", message = "must be a 6-digit code") String code,

        @NotBlank @Size(min = 8, message = "must be at least 8 characters") String password
) {
}
