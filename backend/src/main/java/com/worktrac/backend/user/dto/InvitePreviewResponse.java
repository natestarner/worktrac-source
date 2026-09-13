package com.worktrac.backend.user.dto;

import com.worktrac.backend.membership.MembershipInviteService;

/**
 * What the /join screen needs to ask the right question.
 *
 * <p>{@code mode} is the whole point. An address that already has a Huddle account must be asked to
 * SIGN IN with the password it has; one that does not must be asked to CHOOSE a password. The page
 * used to offer a password field to both and tell the reader to leave it blank if the first case
 * applied — which asks somebody to understand an implementation detail about themselves, and says
 * the opposite of the invitation email they just opened.
 *
 * <p>⚠️ <b>This is answered ONLY to the holder of a valid invite token</b>, and that is what keeps
 * it from being the user-enumeration oracle the invite design forbids — see
 * {@link MembershipInviteService#preview}. The forbidden oracle is the OWNER's, and no owner ever
 * holds this token.
 *
 * <p>{@code email} is the invited address, echoed back so the screen can prefill it read-only and
 * so a signed-in visitor can be told plainly that the invitation is for somebody else. Safe for the
 * same reason: whoever holds the token read it out of that mailbox.
 *
 * <p>Deliberately carries no account id, no person id, no plan and no owner name. A screen deciding
 * which question to ask needs a label and a mode, not a household summary — the same reasoning
 * {@code HouseholdChoiceDto} spells out.
 */
public record InvitePreviewResponse(String householdName, String personName, String email, String mode) {

    /** The invited address already has a Huddle account: it must sign in, not pick a new password. */
    public static final String SIGN_IN = "SIGN_IN";

    /** No account for this address yet: it is choosing a password, and there is nothing to prove. */
    public static final String SET_PASSWORD = "SET_PASSWORD";

    public static InvitePreviewResponse from(MembershipInviteService.InvitePreview preview) {
        return new InvitePreviewResponse(
                preview.householdName(),
                preview.personName(),
                preview.email(),
                preview.recipientHasAccount() ? SIGN_IN : SET_PASSWORD);
    }
}
