package com.worktrac.backend.account;

import com.worktrac.backend.common.NotFoundException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class AccountService {

    private final AccountRepository accountRepository;

    public AccountService(AccountRepository accountRepository) {
        this.accountRepository = accountRepository;
    }

    // Applies only to newly logged sets from now on -- already-logged sets keep the
    // unit they were recorded in (see Set.unit's stamping-at-log-time rule).
    @Transactional
    public AccountDto updateDefaultUnit(Long accountId, String defaultUnit) {
        Account account = accountRepository.findById(accountId)
                .orElseThrow(() -> new NotFoundException("No such account"));
        account.setDefaultUnit(defaultUnit);
        return AccountDto.from(account);
    }
}
