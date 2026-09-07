package com.worktrac.backend.security;

import com.worktrac.backend.config.AdminProperties;
import com.worktrac.backend.membership.AccountAccess;
import com.worktrac.backend.membership.AccountAccessService;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.slf4j.MDC;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.util.List;
import java.util.Optional;

public class JwtAuthenticationFilter extends OncePerRequestFilter {

    private static final String BEARER_PREFIX = "Bearer ";

    private static final String ROLE_ADMIN = "ADMIN";

    private final JwtService jwtService;
    private final AccountAccessService accountAccessService;
    private final AdminProperties adminProperties;

    public JwtAuthenticationFilter(JwtService jwtService, AccountAccessService accountAccessService,
                                    AdminProperties adminProperties) {
        this.jwtService = jwtService;
        this.accountAccessService = accountAccessService;
        this.adminProperties = adminProperties;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response,
                                     FilterChain filterChain) throws ServletException, IOException {
        String header = request.getHeader("Authorization");
        if (header != null && header.startsWith(BEARER_PREFIX)) {
            String token = header.substring(BEARER_PREFIX.length());
            jwtService.parseToken(token).ifPresent(principal -> {
                // A signed, unexpired token is not enough on its own. It must also still map to a
                // live membership whose token version matches -- one lookup answering both halves.
                //
                // Empty covers three cases the filter must treat identically, because all three
                // mean the token is no longer usable: the membership never existed, it has been
                // revoked, or a password reset bumped the user's token version. Without the last
                // of those, a reset did not sign the user out anywhere else, so someone resetting
                // precisely BECAUSE they thought they were compromised stayed compromised for up
                // to thirty more days, on a screen implying otherwise.
                //
                // Leaving the SecurityContext unset falls through to the entry point's 401, which
                // the client already handles as an expired session.
                Optional<AccountAccess> resolved = accountAccessService.resolve(
                        principal.userId(), principal.accountId(), principal.tokenVersion());
                if (resolved.isEmpty()) {
                    return;
                }
                // Resolved ONCE, before the principal is visible to any handler. Everything
                // downstream reads it off the principal rather than looking it up again, so there
                // is a single answer per request and one place to breakpoint when a permission
                // decision surprises you.
                AccountAccess access = resolved.get();
                var authorities = List.of(new SimpleGrantedAuthority("ROLE_" + effectiveRole(principal)));
                var authentication =
                        new UsernamePasswordAuthenticationToken(principal.withAccess(access), null, authorities);
                SecurityContextHolder.getContext().setAuthentication(authentication);
                // Adds the user id to the log context now that a principal actually exists.
                // RequestDiagnosticsFilter (registered ahead of this one) owns the correlation id
                // and clears BOTH keys in its finally -- filters nest, so its cleanup runs after
                // this one returns. Split this way because each filter only writes what it knows:
                // the correlation id is available from a header on every request, the user id only
                // once a token has been parsed.
                MDC.put(RequestDiagnosticsFilter.USER_ID_MDC_KEY, String.valueOf(principal.userId()));
            });
        }
        filterChain.doFilter(request, response);
    }

    // ADMIN_EMAILS is the real source of truth for who is an admin; the role claim is a snapshot
    // taken at login (admin-portal.md). Re-checking the allowlist here means removing someone from
    // it takes effect on their very NEXT REQUEST rather than at their next login -- which, with a
    // 30-day token, could have been a month away.
    //
    // Costs nothing: AdminProperties is in-memory configuration, so there is no lookup to pay for.
    // It can only ever DEMOTE -- a token claiming USER is never promoted here, because the claim is
    // what the account actually had when it was issued. Never invert that: failing open to ADMIN is
    // the one outcome this must not have.
    private String effectiveRole(AccountPrincipal principal) {
        if (ROLE_ADMIN.equals(principal.role()) && !adminProperties.isAdminEmail(principal.email())) {
            return "USER";
        }
        return principal.role();
    }
}
