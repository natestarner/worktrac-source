package com.worktrac.backend.user.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

/**
 * Finishing an invitation.
 *
 * <p>{@code password} is optional on purpose: it is required only when the invited address has no
 * Huddle account yet. For an address that already has one it is ignored entirely — an invitation
 * must never be able to change somebody's existing credentials, which is the single thing a
 * household owner must not be able to do.
 *
 * <p>{@code @Size} alone (no {@code @NotBlank}) is deliberate: {@code null} must keep validating so
 * the optional case above still reaches the service, but a *supplied* value gets the same 8..200
 * bound as registration, reset and change-password — it is setting a credential, not proving one.
 * {@code MembershipInviteService.accept}'s null/blank check is what enforces "required when the
 * address has no account yet"; this is the length floor that check was missing entirely.
 */
public record AcceptInviteRequest(
        @NotNull Long inviteId,

        @NotBlank String token,

        @Size(min = 8, max = 200, message = "must be between 8 and 200 characters") String password
) {
}
