package com.worktrac.backend.user.dto;

import com.worktrac.backend.account.AccountDto;
import com.worktrac.backend.membership.HouseholdChoiceDto;
import com.worktrac.backend.membership.MembershipDto;
import com.worktrac.backend.person.PersonDto;
import com.worktrac.backend.user.UserDto;

import java.util.List;

/**
 * The answer to a sign-in, in one of two shapes.
 *
 * <p><b>Signed in</b> — {@code token} is set and {@code account} / {@code membership} /
 * {@code person} describe where. This is the ONLY shape that existed before member logins, and it
 * is returned byte-for-byte unchanged whenever a login resolves to exactly one household, which is
 * every household today. That is deliberate: the overwhelmingly common path must not change shape
 * because a rare one now exists.
 *
 * <p><b>Choose a household</b> — {@code token} is null, {@code households} lists what this login
 * can sign in to, and {@code selectionToken} is the short-lived proof needed to pick one. Reached
 * only at two or more memberships.
 *
 * <p><b>The client branches on {@code token == null}, not on a status field.</b> One nullable that
 * already had to be read is a smaller surface than a second enum both sides must agree on, and it
 * fails in the safe direction: an old client that ignores {@code households} entirely gets a null
 * token and shows a sign-in failure, rather than a token it cannot use.
 *
 * @param token          a full session token, or null when a household must be chosen first
 * @param households     the choices, non-empty only in the choose-a-household shape
 * @param selectionToken five-minute proof for {@code POST /api/auth/session}, null once signed in
 */
public record AuthResponse(String token, UserDto user, AccountDto account,
                            MembershipDto membership, PersonDto person,
                            List<HouseholdChoiceDto> households, String selectionToken) {

    /** The signed-in shape: exactly what every caller returned before households could be plural. */
    public static AuthResponse signedIn(String token, UserDto user, AccountDto account,
                                         MembershipDto membership, PersonDto person) {
        return new AuthResponse(token, user, account, membership, person, null, null);
    }

    /** The picker shape. No account context exists yet, so there is deliberately none to send. */
    public static AuthResponse chooseHousehold(UserDto user, List<HouseholdChoiceDto> households,
                                                String selectionToken) {
        return new AuthResponse(null, user, null, null, null, households, selectionToken);
    }
}
