package com.worktrac.backend.user.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/**
 * Changing your own password from inside a live session.
 *
 * <p>{@code currentPassword} carries no {@code @Size}, deliberately. It is checked against a hash,
 * not against a policy, and a length rule here would reject a legitimate older password that no
 * longer meets today's minimum — locking somebody out of the very screen that would fix it.
 * {@code newPassword} carries the same 8..200 bound as registration and reset, because it is
 * setting a credential rather than proving one.
 */
public record ChangePasswordRequest(
        @NotBlank String currentPassword,

        @NotBlank @Size(min = 8, max = 200, message = "must be between 8 and 200 characters")
        String newPassword
) {
}
