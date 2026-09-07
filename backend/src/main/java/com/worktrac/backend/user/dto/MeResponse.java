package com.worktrac.backend.user.dto;

import com.worktrac.backend.account.AccountDto;
import com.worktrac.backend.membership.HouseholdChoiceDto;
import com.worktrac.backend.membership.MembershipDto;
import com.worktrac.backend.person.PersonDto;
import com.worktrac.backend.user.UserDto;

import java.util.List;

// `people` is the VISIBLE people, not everyone in the household -- PersonService.list filters it.
// That is the single source of "who exists" for the client, so a member cannot learn who else is
// in the household from the person bar, the Profile page or cache warming.
//
// `households` is every household THIS LOGIN belongs to, including the current one. It exists so
// the account menu can offer "Switch household" only when there is somewhere to switch to, and it
// rides on /me rather than a second endpoint for two reasons: /me is already the single authority
// the client trusts about itself, and it is persisted in the auth snapshot, so the menu renders
// correctly on an offline boot instead of losing an entry until the network returns.
//
// A client on an older auth snapshot has no `households` at all, which reads as "nowhere to switch
// to" and simply hides the entry. That degrades correctly with no SNAPSHOT_VERSION bump -- the
// field is additive and its absence has a sensible meaning, unlike the shape change that forced
// version 2.
public record MeResponse(UserDto user, AccountDto account, MembershipDto membership,
                          List<PersonDto> people, List<HouseholdChoiceDto> households) {
}
