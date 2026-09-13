package com.worktrac.backend.user.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

/**
 * Finishing an invitation.
 *
 * <p>{@code password} means one of two completely different things depending on the invited
 * address, and {@code POST /api/auth/invite/preview} is what tells the client which:
 *
 * <ul>
 *   <li><b>No Huddle account yet</b> — it is being SET. Required.</li>
 *   <li><b>Already has one</b> — it is being PROVED, exactly as at {@code /login}, and it is the
 *       only thing standing between an emailed link and that person's existing identity. It used
 *       to be ignored outright here; see {@code AuthService#acceptInvite} for what that allowed.
 *       An invitation still never CHANGES an existing password — the one thing a household owner
 *       must not be able to do.</li>
 *   <li>Omitted entirely is legitimate for exactly one caller: an invitee who is already signed in
 *       as the invited address, whose session is the proof instead.</li>
 * </ul>
 *
 * <p>⚠️ <b>{@code @Size} alone, with no {@code @NotBlank}, and the floor is now a floor on two
 * different things.</b> {@code null} must keep validating so the already-signed-in case above
 * reaches the service at all. The 8..200 bound is right for a password being set (matching
 * registration, reset and change-password), and harmless for one being proved: no password this
 * app has ever issued is shorter than 8 characters, so a too-short value cannot be a real
 * credential and rejecting it early costs a legitimate caller nothing. It must NOT be relaxed on
 * the "proving" argument — that would make this field a way to probe short passwords without
 * paying the rate limiter.
 */
public record AcceptInviteRequest(
        @NotNull Long inviteId,

        @NotBlank String token,

        @Size(min = 8, max = 200, message = "must be between 8 and 200 characters") String password
) {
}
