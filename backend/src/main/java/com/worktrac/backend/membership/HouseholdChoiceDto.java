package com.worktrac.backend.membership;

/**
 * One row in the "which household?" picker, and in the Switch-household menu.
 *
 * <p>Deliberately much thinner than {@link com.worktrac.backend.account.AccountDto}. This is
 * returned to someone who has proved a password but has <b>not yet chosen an account</b>, so it is
 * the one response in the app that spans households — and everything on it is therefore visible
 * across that boundary. It carries only what a person needs to recognise which household is which:
 * the name they already know, and their own role in it.
 *
 * <p><b>No plan.</b> Billing state is household data, and a member of household A has no business
 * learning whether household B is paying. It would also be a second source for an entitlement that
 * {@code AccountDto.plan} already answers once the account is chosen.
 *
 * <p><b>No person id and no counts.</b> Nothing about who is in the household, how many people it
 * has, or how much is logged there crosses this boundary. A picker needs a label, not a summary.
 */
public record HouseholdChoiceDto(Long accountId, String accountName, String accountRole) {

    public static HouseholdChoiceDto from(AccountMembership membership) {
        return new HouseholdChoiceDto(
                membership.getAccount().getId(),
                membership.getAccount().getName(),
                membership.getAccountRole().name());
    }
}
