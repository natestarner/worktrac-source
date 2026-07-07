package com.worktrac.backend.user.dto;

import com.worktrac.backend.account.AccountDto;
import com.worktrac.backend.person.PersonDto;
import com.worktrac.backend.user.UserDto;

import java.util.List;

public record MeResponse(UserDto user, AccountDto account, List<PersonDto> people) {
}
