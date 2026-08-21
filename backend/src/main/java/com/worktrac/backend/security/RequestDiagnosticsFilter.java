package com.worktrac.backend.security;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.slf4j.MDC;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;

// Puts the browser's per-install correlation id into the SLF4J MDC so every log line this request
// produces carries it, and application.yml's logging.pattern.level emits it.
//
// WHY THIS EXISTS: before it, a Contact Us submission could be correlated to the container logs
// only by timestamp. Nothing outside /api/auth/** logged anything identifying the caller
// (AuthRequestLoggingFilter early-returns on every other path), so triaging a bug report meant
// reading every log line in a time window and guessing which were the reporter's. Now the admin
// portal shows the id alongside the message and one KQL query returns that person's exact request
// trail -- including the errors they hit BEFORE deciding to write in.
//
// Registered FIRST in the chain, ahead of JwtAuthenticationFilter, so even a request rejected
// before it reaches a controller is still tagged. The id comes from a header, so it is available
// immediately; JwtAuthenticationFilter adds the user id once it has actually resolved a principal.
//
// The value is treated as opaque and untrusted: it is sanitized to a conservative character set and
// truncated before it reaches the MDC, because it ends up inside log lines. An attacker-controlled
// value containing newlines could otherwise forge log entries.
//
// KNOWN LIMIT, deliberately not worked around: MDC is thread-local, so it does NOT propagate into
// @Async("emailTaskExecutor") tasks. The email listeners' log lines carry no correlation id; they
// correlate through contact_messages.alert_message_id instead. Its absence there is expected, not a
// bug to go fix.
public class RequestDiagnosticsFilter extends OncePerRequestFilter {

    public static final String CORRELATION_ID_HEADER = "X-Correlation-Id";

    public static final String CORRELATION_ID_MDC_KEY = "cid";
    public static final String USER_ID_MDC_KEY = "uid";

    private static final int MAX_LENGTH = 64;

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response,
                                     FilterChain filterChain) throws ServletException, IOException {
        String correlationId = sanitize(request.getHeader(CORRELATION_ID_HEADER));
        if (correlationId != null) {
            MDC.put(CORRELATION_ID_MDC_KEY, correlationId);
        }
        try {
            filterChain.doFilter(request, response);
        } finally {
            // Request threads are pooled. Without this, one request's context leaks into whatever
            // unrelated request the container hands the thread next -- which is worse than having
            // no correlation id at all, because it points triage confidently at the wrong session.
            MDC.remove(CORRELATION_ID_MDC_KEY);
            MDC.remove(USER_ID_MDC_KEY);
        }
    }

    // Null for anything absent, blank, or not plainly an opaque id. Degrading to "no correlation
    // id" is always safe; letting an arbitrary string into a log line is not.
    private String sanitize(String raw) {
        if (raw == null || raw.isBlank()) {
            return null;
        }
        String trimmed = raw.trim();
        if (trimmed.length() > MAX_LENGTH) {
            trimmed = trimmed.substring(0, MAX_LENGTH);
        }
        return trimmed.matches("[A-Za-z0-9_-]+") ? trimmed : null;
    }
}
