package com.worktrac.backend.user.dto;

import com.worktrac.backend.identity.dto.Reconfirmation;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

/**
 * Setting the FIRST password on a login created with Apple or Google.
 *
 * <p>There is no current password to prove, so the person re-confirms with the provider instead:
 * a live session alone proves a device, not a person, and setting a password on a borrowed,
 * signed-in phone would be a permanent takeover. Same 8..200 bound as registration.
 */
public record SetInitialPasswordRequest(
        @NotBlank @Size(min = 8, max = 200, message = "must be between 8 and 200 characters")
        String newPassword,

        @NotNull @Valid
        Reconfirmation reconfirmation
) {
}
