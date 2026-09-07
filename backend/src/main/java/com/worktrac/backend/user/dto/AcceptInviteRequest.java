package com.worktrac.backend.user.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

/**
 * Finishing an invitation.
 *
 * <p>{@code password} is optional on purpose: it is required only when the invited address has no
 * Huddle account yet. For an address that already has one it is ignored entirely — an invitation
 * must never be able to change somebody's existing credentials, which is the single thing a
 * household owner must not be able to do.
 */
public record AcceptInviteRequest(@NotNull Long inviteId, @NotBlank String token, String password) {
}
