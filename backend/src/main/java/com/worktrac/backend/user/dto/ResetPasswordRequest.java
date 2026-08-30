package com.worktrac.backend.user.dto;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

public record ResetPasswordRequest(
        @NotBlank @Email String email,

        @NotBlank @Pattern(regexp = "\\d{6}", message = "must be a 6-digit code") String code,

        @NotBlank @Size(min = 8, max = 200, message = "must be between 8 and 200 characters") String password
) {
}
