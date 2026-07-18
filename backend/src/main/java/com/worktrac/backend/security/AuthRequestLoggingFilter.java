package com.worktrac.backend.security;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.web.filter.OncePerRequestFilter;
import org.springframework.web.util.ContentCachingRequestWrapper;

import java.io.IOException;

// Front-door safety net for /api/auth/** -- RegistrationService (and PasswordResetService) log
// business-level outcomes, but that only fires once a request actually reaches those services.
// Anything that dies earlier (a CORS rejection, a validation/binding failure before the
// controller method runs, an unhandled exception no @ExceptionHandler covers) currently leaves
// zero trace anywhere. This filter logs method/path/ip/email/status/duration for every request
// on this path regardless of how deep it got, so "did this request even arrive, and what
// happened to it" is always answerable from logs alone.
public class AuthRequestLoggingFilter extends OncePerRequestFilter {

    private static final Logger log = LoggerFactory.getLogger(AuthRequestLoggingFilter.class);
    private static final int MAX_CACHED_BODY_BYTES = 4096;

    private final ObjectMapper objectMapper = new ObjectMapper();

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response,
                                     FilterChain filterChain) throws ServletException, IOException {
        if (!request.getRequestURI().startsWith("/api/auth/")) {
            filterChain.doFilter(request, response);
            return;
        }

        ContentCachingRequestWrapper wrapped = new ContentCachingRequestWrapper(request, MAX_CACHED_BODY_BYTES);
        long startNanos = System.nanoTime();
        try {
            filterChain.doFilter(wrapped, response);
        } catch (Exception e) {
            log.error("{} {} from ip {} email {} threw an unhandled exception", request.getMethod(),
                    request.getRequestURI(), request.getRemoteAddr(), extractEmail(wrapped), e);
            throw e;
        } finally {
            long durationMs = (System.nanoTime() - startNanos) / 1_000_000;
            int status = response.getStatus();
            String message = "{} {} from ip {} email {} -> {} ({} ms)";
            Object[] args = {request.getMethod(), request.getRequestURI(), request.getRemoteAddr(),
                    extractEmail(wrapped), status, durationMs};
            if (status >= 500) {
                log.error(message, args);
            } else if (status >= 400) {
                log.warn(message, args);
            } else {
                log.info(message, args);
            }
        }
    }

    // Pulls out just the "email" field, deliberately ignoring every other field in the body
    // (password, verification code, new password) -- this filter runs on every /api/auth/**
    // request before any business logic has validated the body, so it must never risk logging a
    // credential. Any parse failure (empty body, malformed JSON) just yields "unknown" rather
    // than failing the request.
    private String extractEmail(ContentCachingRequestWrapper request) {
        byte[] content = request.getContentAsByteArray();
        if (content.length == 0) {
            return "unknown";
        }
        try {
            JsonNode email = objectMapper.readTree(content).get("email");
            return email != null ? email.asText() : "unknown";
        } catch (IOException e) {
            return "unknown";
        }
    }
}
