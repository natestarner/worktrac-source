package com.worktrac.backend.membership;

/**
 * One row of the owner's Logins list: a person in the household, and where their login stands.
 *
 * <p><b>{@code status} is deliberately three states, not a boolean.</b> "Has a login" and "has been
 * invited" are different facts with different available actions — you resend or cancel an
 * invitation, you revoke a login — and collapsing them would make the owner's screen unable to tell
 * "I sent that and they haven't acted" from "that never happened".
 *
 * <ul>
 *   <li>{@code NONE} — nobody can sign in as this person</li>
 *   <li>{@code INVITED} — an invitation is outstanding and unexpired</li>
 *   <li>{@code ACTIVE} — a real membership exists</li>
 * </ul>
 *
 * <p>⚠️ <b>{@code INVITED} looks identical whether or not the invited address already had a Huddle
 * account.</b> That is the whole point of the invite design — see
 * {@link MembershipInviteService}'s class comment. If a future change ever adds a fourth state
 * meaning "accepted instantly because they already had an account", it has reintroduced a
 * user-enumeration oracle.
 *
 * <p>{@code email} is the address invited or signed in, and is null for {@code NONE}. The owner
 * typed it in the first place, so showing it back is not new information — and without it they
 * cannot tell which of two similar addresses they used.
 *
 * <p>{@code isSelf} marks the viewer's own row, and exists so the client can withhold <b>Remove</b>
 * there. An owner removing their own login is refused server-side (409) because nothing in the app
 * could put it back and a household with no owner has nobody who can invite one — but a button
 * that can only ever fail is a bug in its own right, and the client cannot work this out alone:
 * every row on this screen is a person in the viewer's own household, so there is nothing else in
 * the payload that distinguishes "me" from "somebody else here".
 */
public record PersonLoginDto(Long personId, String personName, String status, String email,
                             boolean isSelf) {

    public static final String NONE = "NONE";
    public static final String INVITED = "INVITED";
    public static final String ACTIVE = "ACTIVE";
}
