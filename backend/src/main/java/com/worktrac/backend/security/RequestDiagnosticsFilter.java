package com.worktrac.backend.security;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.slf4j.MDC;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

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
// The same filter tags each line with the CLIENT BUILD (X-Huddle-Client: "ios/1.4.0+57" from the
// App Store app, "web/2026-10-21T01:00" from a browser). An App Store install can be months
// behind, so before anything is removed from the API, the logs have to be able to say which builds
// are still calling it (docs/azure-read-only-access.md). Sanitized the same way, with a character
// set that admits the version punctuation.
//
// MDC is thread-local, so it does not follow work onto another thread by itself. Outbox rows carry
// the cid of the request that wrote them, and OutboxDispatcher puts it back in the MDC while it
// delivers one, so an email's send and audit log lines join the trail of the request that caused
// it -- on whichever replica sends it.
//
// OPTIONAL ACCESS LOG (app.request-log.enabled, on in lower only): one "access" line per request
// with method, path, status, duration, ip, user agent and origin. Lower scales to zero, yet woke on
// nearly every day of a 30-day window with nothing in the logs saying who called -- ACA's ingress
// keeps no request log, and only /api/auth/** (AuthRequestLoggingFilter) logged its callers. This
// line answers "which device, tab or scanner keeps waking lower": cid/uid/client come from the MDC
// (written after the chain ran, so uid is filled in for an authenticated call), and ua/origin tell
// a forgotten browser tab from a bot. It lives here rather than in its own filter because this is
// where the caller's MDC context already exists, and a separate filter would have to be ordered
// between this one and JwtAuthenticationFilter, a slot addFilterBefore cannot express without a tie.
// Off in production, where real traffic would make it noise; the query string is never logged, since
// verification and reset links carry their codes there.
public class RequestDiagnosticsFilter extends OncePerRequestFilter {

    private static final Logger log = LoggerFactory.getLogger(RequestDiagnosticsFilter.class);

    public static final String CORRELATION_ID_HEADER = "X-Correlation-Id";

    public static final String CORRELATION_ID_MDC_KEY = "cid";
    public static final String CLIENT_HEADER = "X-Huddle-Client";
    public static final String CLIENT_MDC_KEY = "client";
    public static final String USER_ID_MDC_KEY = "uid";

    private static final int MAX_LENGTH = 64;
    private static final int CLIENT_MAX_LENGTH = 40;
    private static final int ACCESS_FIELD_MAX_LENGTH = 200;
    // The kubelet's own liveness/readiness probes (user agent "kube-probe/1.x") reach the container
    // directly every few seconds while it is up, so logging them would bury the callers worth
    // finding. They never wake a scaled-to-zero app -- only ingress traffic does -- so dropping them
    // loses nothing. Anything else calling /actuator/health IS logged: an uptime monitor pointed at
    // lower is exactly the kind of caller this log exists to find.
    private static final String PROBE_USER_AGENT_PREFIX = "kube-probe/";
    private static final Pattern REFERER_ORIGIN = Pattern.compile("^([A-Za-z][A-Za-z0-9+.-]*://[^/?#]+)");

    private final boolean logEveryRequest;

    public RequestDiagnosticsFilter() {
        this(false);
    }

    public RequestDiagnosticsFilter(boolean logEveryRequest) {
        this.logEveryRequest = logEveryRequest;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response,
                                     FilterChain filterChain) throws ServletException, IOException {
        String correlationId = sanitize(request.getHeader(CORRELATION_ID_HEADER));
        if (correlationId != null) {
            MDC.put(CORRELATION_ID_MDC_KEY, correlationId);
        }
        String client = sanitizeClient(request.getHeader(CLIENT_HEADER));
        if (client != null) {
            MDC.put(CLIENT_MDC_KEY, client);
        }
        long startNanos = System.nanoTime();
        try {
            filterChain.doFilter(request, response);
        } finally {
            if (logEveryRequest) {
                logAccess(request, response, (System.nanoTime() - startNanos) / 1_000_000);
            }
            // Request threads are pooled. Without this, one request's context leaks into whatever
            // unrelated request the container hands the thread next -- which is worse than having
            // no correlation id at all, because it points triage confidently at the wrong session.
            MDC.remove(CORRELATION_ID_MDC_KEY);
            MDC.remove(CLIENT_MDC_KEY);
            MDC.remove(USER_ID_MDC_KEY);
        }
    }

    private void logAccess(HttpServletRequest request, HttpServletResponse response, long durationMs) {
        String userAgent = request.getHeader("User-Agent");
        if (userAgent != null && userAgent.startsWith(PROBE_USER_AGENT_PREFIX)) {
            return;
        }
        // An exception still propagating reports 200 here; the servlet container turns it into a
        // 500 after this filter returns. The line is about who called, so that is left as is.
        log.info("access {} {} -> {} ({} ms) ip={} ua=\"{}\" origin={}",
                request.getMethod(), printable(request.getRequestURI()), response.getStatus(), durationMs,
                ClientIpResolver.resolveClientIp(request), printable(userAgent), origin(request));
    }

    // Origin when the browser sent one (every cross-origin fetch does); otherwise only the scheme and
    // host of the Referer, because a full Referer can be a reset or invite link with its code in it.
    private static String origin(HttpServletRequest request) {
        String origin = request.getHeader("Origin");
        if (origin == null || origin.isBlank()) {
            String referer = request.getHeader("Referer");
            if (referer != null) {
                Matcher m = REFERER_ORIGIN.matcher(referer);
                origin = m.find() ? m.group(1) : null;
            }
        }
        return printable(origin);
    }

    // Header values and scanner-sent paths are attacker-controlled and go straight into a log line,
    // so anything outside printable ASCII (newlines above all, which would forge a second entry) and
    // the double quote that delimits ua="..." become '?'. Unlike the MDC values above, these are kept
    // rather than dropped: a mangled user agent still identifies a device; a missing one does not.
    static String printable(String raw) {
        if (raw == null || raw.isBlank()) {
            return "-";
        }
        String trimmed = raw.length() > ACCESS_FIELD_MAX_LENGTH ? raw.substring(0, ACCESS_FIELD_MAX_LENGTH) : raw;
        StringBuilder out = new StringBuilder(trimmed.length());
        for (char c : trimmed.toCharArray()) {
            out.append(c >= 0x20 && c < 0x7f && c != '"' ? c : '?');
        }
        return out.toString();
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

    // Same rule as above, widened only by the punctuation a build string needs ("ios/1.4.0+57",
    // "web/2026-10-21T01:00"). No spaces, brackets or newlines, so it cannot break out of its
    // [client=...] slot in the log pattern.
    static String sanitizeClient(String raw) {
        if (raw == null || raw.isBlank()) {
            return null;
        }
        String trimmed = raw.trim();
        if (trimmed.length() > CLIENT_MAX_LENGTH) {
            trimmed = trimmed.substring(0, CLIENT_MAX_LENGTH);
        }
        return trimmed.matches("[A-Za-z0-9._+/:-]+") ? trimmed : null;
    }
}
