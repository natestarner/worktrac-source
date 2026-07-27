package com.worktrac.backend.common;

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
    public ResponseEntity<ApiError> handleValidation(MethodArgumentNotValidException ex) {
        String message = ex.getBindingResult().getFieldErrors().stream()
                .findFirst()
                .map(fe -> fe.getField() + " " + fe.getDefaultMessage())
                .orElse("Invalid request");
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
    public ResponseEntity<ApiError> handleMalformedRequest(HttpMessageNotReadableException ex) {
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
    public ResponseEntity<ApiError> handleDataAccess(DataAccessException ex) {
        log.error("Database access error", ex);
        return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE).body(ApiError.of(503, "Service temporarily unavailable"));
    }

    // Last resort: any exception not already handled above. Never let this escape to the
    // container's /error dispatch (see class-level comment) -- always answer with a real status
    // instead.
    @ExceptionHandler(Exception.class)
    public ResponseEntity<ApiError> handleUnexpected(Exception ex) {
        log.error("Unhandled exception", ex);
        return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(ApiError.of(500, "Something went wrong"));
    }
}
