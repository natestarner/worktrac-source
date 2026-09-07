package com.worktrac.backend.user;

import com.worktrac.backend.membership.Permission;
import com.worktrac.backend.membership.RequiresPermission;
import com.worktrac.backend.security.CurrentUser;
import com.worktrac.backend.user.dto.AuthResponse;
import com.worktrac.backend.user.dto.ChangePasswordRequest;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * The signed-in half of password management: changing your own.
 *
 * <p>Under {@code /api/user}, not {@code /api/account} — a password belongs to a login, not to a
 * household. The distinction is load-bearing now that one login can belong to several households:
 * an account-scoped route would read as "this household's password", which is exactly the mental
 * model the identity/membership split exists to break.
 *
 * <p>And NOT on {@code AuthController}, even though the other password routes live there.
 * {@code /api/auth/**} is {@code permitAll} — its routes are the ones reachable without a session —
 * which is also why {@code HandlerPermissionCoverageTest} exempts that whole class. Putting an
 * authenticated route there would quietly opt it out of the only mechanical guarantee the app has
 * that somebody chose its authorization.
 */
@RestController
@RequestMapping("/api/user")
public class UserPasswordController {

    private final PasswordChangeService passwordChangeService;
    private final CurrentUser currentUser;

    public UserPasswordController(PasswordChangeService passwordChangeService, CurrentUser currentUser) {
        this.passwordChangeService = passwordChangeService;
        this.currentUser = currentUser;
    }

    /**
     * Changes the caller's own password and returns a REPLACEMENT SESSION.
     *
     * <p>The response is a full {@code AuthResponse} rather than 204 because the change bumps
     * {@code token_version} — see {@link PasswordChangeService#changePassword}. The client must
     * swap the returned token in, or its next request 401s on the strength of its own success.
     */
    @PostMapping("/password")
    @RequiresPermission(Permission.CHANGE_OWN_PASSWORD)
    public AuthResponse changePassword(@Valid @RequestBody ChangePasswordRequest request) {
        return passwordChangeService.changePassword(
                currentUser.userId(), currentUser.accountId(), request);
    }
}
