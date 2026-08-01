package com.worktrac.backend.common;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.worktrac.backend.registrationaudit.RegistrationAuditService;
import com.worktrac.backend.registrationaudit.RegistrationEventType;
import jakarta.servlet.http.HttpServletRequest;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataAccessException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;
import org.springframework.web.util.ContentCachingRequestWrapper;
import org.springframework.web.util.WebUtils;

import java.io.IOException;
import java.util.Set;

// Every handler here returns a normal ResponseEntity instead of letting the exception escape --
// an escaped exception triggers the servlet container's internal forward to /error, which
// re-runs the (stateless) security filter chain as an ANONYMOUS request and turns even a benign
// 400-shaped failure into a 401 that force-logs-out an otherwise-valid session (see the
// SecurityConfig comment on exceptionHandling for the full mechanism). The specific handlers plus
// the Exception catch-all below are what close that off for every failure mode, not just the ones
// already anticipated with a dedicated exception type.
@RestControllerAdvice
public class GlobalExceptionHandler {

    private static final Logger log = LoggerFactory.getLogger(GlobalExceptionHandler.class);

    // Only these three ever get an UNEXPECTED_ERROR audit row -- RegistrationService already
    // covers the rest of /api/auth/** itself once a request actually reaches it; this is only
    // for a request to one of these that dies before/outside that.
    private static final Set<String> REGISTRATION_PATHS = Set.of(
            "/api/auth/register", "/api/auth/confirm-email", "/api/auth/resend-code");

    // Only used to re-parse the cached request body for the "email" field -- no app-wide
    // ObjectMapper bean exists to autowire (see AuthRequestLoggingFilter's identical comment).
    private final ObjectMapper objectMapper = new ObjectMapper();
    private final RegistrationAuditService auditService;

    public GlobalExceptionHandler(RegistrationAuditService auditService) {
        this.auditService = auditService;
    }

    @ExceptionHandler(NotFoundException.class)
    public ResponseEntity<ApiError> handleNotFound(NotFoundException ex) {
        return ResponseEntity.status(HttpStatus.NOT_FOUND).body(ApiError.of(404, ex.getMessage()));
    }

    @ExceptionHandler(ForbiddenException.class)
    public ResponseEntity<ApiError> handleForbidden(ForbiddenException ex) {
        return ResponseEntity.status(HttpStatus.FORBIDDEN).body(ApiError.of(403, ex.getMessage()));
    }

    @ExceptionHandler(ConflictException.class)
    public ResponseEntity<ApiError> handleConflict(ConflictException ex) {
        return ResponseEntity.status(HttpStatus.CONFLICT).body(ApiError.of(409, ex.getMessage()));
    }

    @ExceptionHandler(UnauthorizedException.class)
    public ResponseEntity<ApiError> handleUnauthorized(UnauthorizedException ex) {
        return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(ApiError.of(401, ex.getMessage()));
    }

    @ExceptionHandler(ExpiredException.class)
    public ResponseEntity<ApiError> handleExpired(ExpiredException ex) {
        return ResponseEntity.status(HttpStatus.GONE).body(ApiError.of(410, ex.getMessage()));
    }

    @ExceptionHandler(LockedException.class)
    public ResponseEntity<ApiError> handleLocked(LockedException ex) {
        return ResponseEntity.status(HttpStatus.LOCKED).body(ApiError.of(423, ex.getMessage()));
    }

    @ExceptionHandler(TooManyRequestsException.class)
    public ResponseEntity<ApiError> handleTooManyRequests(TooManyRequestsException ex) {
        return ResponseEntity.status(HttpStatus.TOO_MANY_REQUESTS).body(ApiError.of(429, ex.getMessage()));
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<ApiError> handleValidation(MethodArgumentNotValidException ex, HttpServletRequest request) {
        String message = ex.getBindingResult().getFieldErrors().stream()
                .findFirst()
                .map(fe -> fe.getField() + " " + fe.getDefaultMessage())
                .orElse("Invalid request");
        recordIfRegistrationRoute(request, "Validation failed: " + message);
        return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(ApiError.of(400, message));
    }

    @ExceptionHandler(IllegalArgumentException.class)
    public ResponseEntity<ApiError> handleIllegalArgument(IllegalArgumentException ex) {
        return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(ApiError.of(400, ex.getMessage()));
    }

    // A malformed request body -- e.g. a client-side id-mapping bug sending a temp string id
    // ("temp-exercise-<uuid>") where the DTO expects a Long -- fails deserialization before any
    // handler method runs. This is the exact trigger that used to collapse into a 401 logout.
    @ExceptionHandler(HttpMessageNotReadableException.class)
    public ResponseEntity<ApiError> handleMalformedRequest(HttpMessageNotReadableException ex, HttpServletRequest request) {
        recordIfRegistrationRoute(request, "Malformed request body");
        return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(ApiError.of(400, "Malformed request body"));
    }

    // A path/query param that doesn't match its declared type (e.g. a non-numeric id).
    @ExceptionHandler(MethodArgumentTypeMismatchException.class)
    public ResponseEntity<ApiError> handleTypeMismatch(MethodArgumentTypeMismatchException ex) {
        return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(ApiError.of(400, "Invalid request parameter"));
    }

    // The database is unreachable/erroring (e.g. connection pool exhausted, outage). This is
    // transient from the client's point of view -- the frontend's offline mode treats any 5xx as
    // "server unreachable" and queues/retries the write rather than treating it as a rejection.
    @ExceptionHandler(DataAccessException.class)
    public ResponseEntity<ApiError> handleDataAccess(DataAccessException ex, HttpServletRequest request) {
        log.error("Database access error", ex);
        recordIfRegistrationRoute(request, "Database access error: " + ex.getMessage());
        return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE).body(ApiError.of(503, "Service temporarily unavailable"));
    }

    // Last resort: any exception not already handled above. Never let this escape to the
    // container's /error dispatch (see class-level comment) -- always answer with a real status
    // instead.
    @ExceptionHandler(Exception.class)
    public ResponseEntity<ApiError> handleUnexpected(Exception ex, HttpServletRequest request) {
        log.error("Unhandled exception", ex);
        recordIfRegistrationRoute(request, ex.getClass().getSimpleName() + ": " + ex.getMessage());
        return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(ApiError.of(500, "Something went wrong"));
    }

    // Records UNEXPECTED_ERROR for a request to one of the three registration endpoints that
    // never reached RegistrationService -- a malformed body, a validation failure, a database
    // error, or any other exception this class had to catch. Deliberately best-effort: recording
    // an error is itself a database write, so if the underlying cause IS a full database outage
    // this can fail too (or simply have nothing to write to) -- that failure is swallowed here
    // rather than risking a second exception escaping from within error handling itself, which
    // would defeat the whole point of this class (see the class-level comment).
    private void recordIfRegistrationRoute(HttpServletRequest request, String reason) {
        if (!REGISTRATION_PATHS.contains(request.getRequestURI())) {
            return;
        }
        try {
            auditService.record(extractEmail(request), RegistrationEventType.UNEXPECTED_ERROR, reason,
                    request.getRemoteAddr());
        } catch (Exception e) {
            log.error("Failed to record UNEXPECTED_ERROR audit event", e);
        }
    }

    // Mirrors AuthRequestLoggingFilter's extractEmail -- that filter wraps every /api/auth/**
    // request in a ContentCachingRequestWrapper before the request reaches here, so the cached
    // body bytes are still available even after a failed parse/validation attempt. Deliberately
    // pulls out only "email", never password/code, for the same reason as that filter.
    //
    // A plain `request instanceof ContentCachingRequestWrapper` check does NOT work here (confirmed
    // by a real test failure without this fix: the recorded email was always "unknown") -- Spring
    // Security's own filters wrap the request in further HttpServletRequestWrapper layers between
    // AuthRequestLoggingFilter and here, so the wrapper this method actually receives is not our
    // ContentCachingRequestWrapper itself but something wrapping it. WebUtils.getNativeRequest
    // unwraps through any number of ServletRequestWrapper layers to find it, which is exactly what
    // AuthRequestLoggingFilter never needed (it reads its own local `wrapped` variable directly,
    // never re-resolving it through a wrapper chain).
    private String extractEmail(HttpServletRequest request) {
        ContentCachingRequestWrapper wrapper = WebUtils.getNativeRequest(request, ContentCachingRequestWrapper.class);
        if (wrapper == null) {
            return "unknown";
        }
        byte[] content = wrapper.getContentAsByteArray();
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
