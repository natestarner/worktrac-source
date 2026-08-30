package com.worktrac.backend.security;

import com.worktrac.backend.config.AdminProperties;
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

public class JwtAuthenticationFilter extends OncePerRequestFilter {

    private static final String BEARER_PREFIX = "Bearer ";

    private static final String ROLE_ADMIN = "ADMIN";

    private final JwtService jwtService;
    private final TokenVersionService tokenVersionService;
    private final AdminProperties adminProperties;

    public JwtAuthenticationFilter(JwtService jwtService, TokenVersionService tokenVersionService,
                                    AdminProperties adminProperties) {
        this.jwtService = jwtService;
        this.tokenVersionService = tokenVersionService;
        this.adminProperties = adminProperties;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response,
                                     FilterChain filterChain) throws ServletException, IOException {
        String header = request.getHeader("Authorization");
        if (header != null && header.startsWith(BEARER_PREFIX)) {
            String token = header.substring(BEARER_PREFIX.length());
            jwtService.parseToken(token).ifPresent(principal -> {
                // A signed, unexpired token is not enough on its own -- it must also not have
                // been revoked. Without this a password reset did not sign the user out
                // anywhere else, so someone resetting precisely BECAUSE they thought they were
                // compromised stayed compromised for up to thirty more days, on a screen
                // implying otherwise. Leaving the SecurityContext unset falls through to the
                // entry point's 401, which the client already handles as an expired session.
                if (!tokenVersionService.isCurrent(principal.userId(), principal.tokenVersion())) {
                    return;
                }
                var authorities = List.of(new SimpleGrantedAuthority("ROLE_" + effectiveRole(principal)));
                var authentication = new UsernamePasswordAuthenticationToken(principal, null, authorities);
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
