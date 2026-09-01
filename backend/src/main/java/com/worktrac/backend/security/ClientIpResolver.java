package com.worktrac.backend.security;

import jakarta.servlet.http.HttpServletRequest;

// The one place client IP is derived, for every per-IP rate limiter and every diagnostic log line
// that records "which caller did this."
//
// Azure Container Apps' HTTP ingress is the sole path to this container -- nothing else can reach
// it -- and per its own docs (Ingress in Azure Container Apps -> HTTP headers table), X-Forwarded-
// For "If specified in initial request, is appended to. Only the rightmost IP is provided by Azure
// Container Apps. Any other values must be validated by the user to prevent IP spoofing." In other
// words: ACA passes an attacker-supplied X-Forwarded-For straight through and appends its own
// observed peer address as the LAST entry -- it does not drop or sanitize what the client sent.
//
// `server.forward-headers-strategy: framework` did the opposite of what's safe here: Spring's
// ForwardedHeaderFilter trusts the FIRST (leftmost) entry, which on this platform is exactly the
// value an external caller controls. Confirmed live on lower 2026-08-31: a login POST sent with
// `X-Forwarded-For: 9.9.9.9, 8.8.8.8` was logged -- and would have been rate-limited -- as coming
// from 9.9.9.9, fully attacker-chosen. That fully defeats LoginRateLimiter's per-IP bucket (just
// rotate a fake leftmost value per request) and every sibling per-IP limiter fed by
// AuthController/ContactController the same way. See
// docs/incidents/2026-08-31-xff-spoofing-bypassed-per-ip-rate-limits.md.
//
// `forward-headers-strategy` is therefore `none` (application.yml) -- Spring no longer touches
// X-Forwarded-For or getRemoteAddr() at all -- and this class reads the raw header itself, taking
// the LAST entry: the one hop ACA itself appends and vouches for, never the client-suppliable
// prefix in front of it.
public final class ClientIpResolver {

    private static final String FORWARDED_FOR_HEADER = "X-Forwarded-For";

    private ClientIpResolver() {
    }

    public static String resolveClientIp(HttpServletRequest request) {
        String forwardedFor = request.getHeader(FORWARDED_FOR_HEADER);
        if (forwardedFor != null) {
            String[] hops = forwardedFor.split(",");
            for (int i = hops.length - 1; i >= 0; i--) {
                String candidate = hops[i].trim();
                if (!candidate.isEmpty()) {
                    return candidate;
                }
            }
        }
        // No header at all -- a direct connection with no reverse proxy in front (local dev,
        // most tests). Never reached in lower/production: ACA adds the header to every request
        // that passes through its ingress, whether or not the client set one.
        return request.getRemoteAddr();
    }
}
