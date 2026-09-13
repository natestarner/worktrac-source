package com.worktrac.backend.user.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

/**
 * Asking an invitation what it wants, before answering it.
 *
 * <p>The same two halves as {@link AcceptInviteRequest} and for the same reason: a BCrypt hash has
 * a per-row salt, so there is no equality to index and the token alone cannot find its row. The id
 * is the lookup; the token is the proof.
 */
public record InvitePreviewRequest(
        @NotNull Long inviteId,

        @NotBlank String token
) {
}
