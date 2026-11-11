package com.worktrac.backend.identity;

import com.worktrac.backend.identity.dto.ConnectIdentityRequest;
import com.worktrac.backend.identity.dto.SignInMethodsResponse;
import com.worktrac.backend.membership.Permission;
import com.worktrac.backend.membership.RequiresPermission;
import com.worktrac.backend.security.CurrentUser;
import com.worktrac.backend.user.dto.AuthResponse;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * The signed-in half: which Apple / Google accounts can sign in to MY login, and connecting or
 * disconnecting one. Under {@code /api/user} beside the password route, for the reason
 * {@code UserPasswordController} gives -- a way in belongs to a login, not to a household.
 *
 * <p>Every route acts on {@code currentUser.userId()} and nothing else. There is no
 * {@code userId} in any path or body, deliberately: an owner must never be able to attach their
 * own Google account to a member's login, which would let them sign in as that member.
 */
@RestController
@RequestMapping("/api/user/sign-in-methods")
public class SignInMethodsController {

    private final SocialSignInService socialSignInService;
    private final CurrentUser currentUser;

    public SignInMethodsController(SocialSignInService socialSignInService, CurrentUser currentUser) {
        this.socialSignInService = socialSignInService;
        this.currentUser = currentUser;
    }

    @GetMapping
    @RequiresPermission(Permission.MANAGE_OWN_SIGN_IN_METHODS)
    public SignInMethodsResponse list() {
        return socialSignInService.methods(currentUser.userId());
    }

    @PostMapping("/{provider}")
    @RequiresPermission(Permission.MANAGE_OWN_SIGN_IN_METHODS)
    public SignInMethodsResponse connect(@PathVariable String provider,
                                         @Valid @RequestBody ConnectIdentityRequest request) {
        return socialSignInService.connect(currentUser.userId(), provider, request);
    }

    /** Returns a replacement session: disconnecting signs out every other session. */
    @DeleteMapping("/{provider}")
    @RequiresPermission(Permission.MANAGE_OWN_SIGN_IN_METHODS)
    public AuthResponse disconnect(@PathVariable String provider) {
        return socialSignInService.disconnect(currentUser.userId(), currentUser.accountId(), provider);
    }
}
