package com.worktrac.backend.account;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;

public record DeleteAccountRequest(
        @NotBlank
        @Pattern(regexp = "DELETE", message = "you must type DELETE to confirm")
        String confirmationText) {
}
