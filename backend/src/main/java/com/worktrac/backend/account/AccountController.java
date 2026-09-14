package com.worktrac.backend.account;

import com.worktrac.backend.membership.RequiresPermission;
import com.worktrac.backend.membership.Permission;
import com.worktrac.backend.security.CurrentUser;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
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
    @RequiresPermission(Permission.MANAGE_HOUSEHOLD)
    public AccountDto updateDefaultUnit(@Valid @RequestBody UpdateDefaultUnitRequest request) {
        return accountService.updateDefaultUnit(currentUser.accountId(), request.defaultUnit());
    }

    /**
     * Whether members of this account see everyone in it, or only themselves.
     *
     * <p>{@code MANAGE_HOUSEHOLD}, so OWNER only — deliberately not a MANAGER. An assistant with
     * full reach over every client must not be able to decide whether the clients can see each
     * other; that is a promise the account made to the people in it, and it belongs to whoever
     * made it. {@code Permission.MANAGE_HOUSEHOLD}'s own javadoc has named this setting as its
     * scope since before the setting was reachable.
     *
     * <p>The PLAN gate is in the service rather than here, because it answers 409 (you could, on
     * Pro) rather than 403 (not you), and an interceptor cannot tell those apart.
     */
    @PutMapping("/member-visibility")
    @RequiresPermission(Permission.MANAGE_HOUSEHOLD)
    public AccountDto setMemberVisibility(@Valid @RequestBody MemberVisibilityRequest request) {
        return accountService.setMemberVisibility(currentUser.accountId(), request.membersSeeEveryone());
    }

    public record MemberVisibilityRequest(@NotNull Boolean membersSeeEveryone) {
    }

    @DeleteMapping
    @RequiresPermission(Permission.DELETE_ACCOUNT)
    public ResponseEntity<Void> deleteAccount(@Valid @RequestBody DeleteAccountRequest request) {
        accountDeletionService.deleteAccount(currentUser.accountId(), currentUser.userId(), request.password());
        return ResponseEntity.noContent().build();
    }
}
