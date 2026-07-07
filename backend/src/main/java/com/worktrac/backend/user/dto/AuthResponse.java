package com.worktrac.backend.user.dto;

import com.worktrac.backend.account.AccountDto;
import com.worktrac.backend.person.PersonDto;
import com.worktrac.backend.user.UserDto;

public record AuthResponse(String token, UserDto user, AccountDto account, PersonDto person) {
}
