package com.worktrac.backend.identity;

import com.worktrac.backend.identity.dto.SocialSignInRequest;
import com.worktrac.backend.security.ClientIpResolver;
import com.worktrac.backend.user.dto.AuthResponse;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Sign in (or up) with Apple or Google: the provider's ID token in, a Huddle session out.
 *
 * <p>{@code permitAll} in SecurityConfig, like {@code /api/auth/login} and for the same reason --
 * the caller has no session yet; acquiring one is the point. That is also why
 * {@code HandlerPermissionCoverageTest} exempts this class: there is no household to hold a
 * permission in. The ID token is the whole credential, and {@link IdTokenVerifier} is what checks
 * it. Connecting and disconnecting run on a session and live in {@link SignInMethodsController}.
 */
@RestController
@RequestMapping("/api/auth/oauth")
public class SocialSignInController {

    private final SocialSignInService socialSignInService;

    public SocialSignInController(SocialSignInService socialSignInService) {
        this.socialSignInService = socialSignInService;
    }

    @PostMapping("/{provider}")
    public AuthResponse signIn(@PathVariable String provider, @Valid @RequestBody SocialSignInRequest request,
                               HttpServletRequest servletRequest) {
        return socialSignInService.signIn(provider, request, ClientIpResolver.resolveClientIp(servletRequest));
    }
}
