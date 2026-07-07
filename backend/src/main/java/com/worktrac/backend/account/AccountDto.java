package com.worktrac.backend.account;

public record AccountDto(Long id, String name, String defaultUnit) {

    public static AccountDto from(Account account) {
        return new AccountDto(account.getId(), account.getName(), account.getDefaultUnit());
    }
}
