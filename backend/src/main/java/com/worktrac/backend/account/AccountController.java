package com.worktrac.backend.account;

import com.worktrac.backend.membership.RequiresPermission;
import com.worktrac.backend.membership.Permission;
import com.worktrac.backend.security.CurrentUser;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
@RequestMapping("/api/account")
public class AccountController {

    private final AccountService accountService;
    private final AccountDeletionService accountDeletionService;
    private final RosterService rosterService;
    private final CurrentUser currentUser;

    public AccountController(AccountService accountService, AccountDeletionService accountDeletionService,
                              RosterService rosterService, CurrentUser currentUser) {
        this.accountService = accountService;
        this.accountDeletionService = accountDeletionService;
        this.rosterService = rosterService;
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

    /**
     * Everyone this login can see, quietest first — the trainer's answer to "who has stopped
     * showing up?".
     *
     * <p>{@code VIEW_OTHER_PEOPLE}, the same permission that decides whether the person switcher
     * shows anybody else — so an OWNER or a MANAGER reaches it and a private client does not.
     *
     * <p>⚠️ A private client is refused by the interceptor with a 403, before this method runs. An
     * earlier version of this comment claimed they would get a roster of exactly themselves; that
     * was never true, and the client was offering them the menu item on the strength of it until an
     * e2e caught it. The entry point in {@code UserMenu} now excludes a member for that reason — a
     * control the server will refuse must not be offered ({@code member-access.md}).
     *
     * <p>A roster of one person is not a screen worth reaching anyway. What a client wants is their
     * own History, which they already have.
     *
     * <p>{@code zone} is the caller's IANA zone, because "days since" and "this week" mean the
     * viewer's calendar, not the server's UTC storage. An unrecognised one degrades to UTC.
     */
    @GetMapping("/roster")
    @RequiresPermission(Permission.VIEW_OTHER_PEOPLE)
    public List<RosterEntryDto> roster(@RequestParam(required = false) String zone,
                                       @RequestParam(required = false) Integer weeks) {
        return rosterService.roster(currentUser.access(), zone, weeks);
    }

    @DeleteMapping
    @RequiresPermission(Permission.DELETE_ACCOUNT)
    public ResponseEntity<Void> deleteAccount(@Valid @RequestBody DeleteAccountRequest request) {
        accountDeletionService.deleteAccount(currentUser.accountId(), currentUser.userId(), request.password());
        return ResponseEntity.noContent().build();
    }
}
