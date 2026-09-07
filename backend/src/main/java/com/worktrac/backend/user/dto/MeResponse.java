package com.worktrac.backend.user.dto;

import com.worktrac.backend.account.AccountDto;
import com.worktrac.backend.membership.MembershipDto;
import com.worktrac.backend.person.PersonDto;
import com.worktrac.backend.user.UserDto;

import java.util.List;

// `people` is the VISIBLE people, not everyone in the household -- PersonService.list filters it.
// That is the single source of "who exists" for the client, so a member cannot learn who else is
// in the household from the person bar, the Profile page or cache warming.
public record MeResponse(UserDto user, AccountDto account, MembershipDto membership,
                          List<PersonDto> people) {
}
