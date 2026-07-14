package com.worktrac.backend.account;

import com.worktrac.backend.security.CurrentUser;
import jakarta.validation.Valid;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/account")
public class AccountController {

    private final AccountService accountService;
    private final AccountDeletionService accountDeletionService;
    private final CurrentUser currentUser;

    public AccountController(AccountService accountService, AccountDeletionService accountDeletionService,
                              CurrentUser currentUser) {
        this.accountService = accountService;
        this.accountDeletionService = accountDeletionService;
        this.currentUser = currentUser;
    }

    @PutMapping("/default-unit")
    public AccountDto updateDefaultUnit(@Valid @RequestBody UpdateDefaultUnitRequest request) {
        return accountService.updateDefaultUnit(currentUser.accountId(), request.defaultUnit());
    }

    @DeleteMapping
    public ResponseEntity<Void> deleteAccount(@Valid @RequestBody DeleteAccountRequest request) {
        accountDeletionService.deleteAccount(currentUser.accountId());
        return ResponseEntity.noContent().build();
    }
}
