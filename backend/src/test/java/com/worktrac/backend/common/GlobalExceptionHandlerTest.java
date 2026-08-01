package com.worktrac.backend.common;

import com.worktrac.backend.registrationaudit.RegistrationAuditService;
import com.worktrac.backend.registrationaudit.RegistrationEventType;
import jakarta.servlet.http.HttpServletRequest;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.http.HttpInputMessage;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.contains;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

// Pure unit tests of the handler methods -- no Spring context needed, since each method is just
// (exception in, ResponseEntity out). What matters here: NONE of these handlers let their
// exception escape unhandled, because an escaped exception triggers the servlet container's
// /error re-dispatch, which re-runs the stateless security chain as anonymous and turns even a
// benign failure into a 401 that force-logs-out an otherwise-valid session (see the SecurityConfig
// comment on exceptionHandling, and the real-request regression test in LiveSetErrorResponseTest).
//
// The registration-route audit recording added alongside this is deliberately verified with mocks
// here (not real body extraction -- that needs the real ContentCachingRequestWrapper the servlet
// filter chain provides, covered instead by the real end-to-end request in
// AuthControllerRateLimitTest's frontDoorFilterLogsRequestsThatNeverReachTheService).
class GlobalExceptionHandlerTest {

    private final RegistrationAuditService auditService = mock(RegistrationAuditService.class);
    private final GlobalExceptionHandler handler = new GlobalExceptionHandler(auditService);

    private HttpServletRequest requestTo(String uri) {
        HttpServletRequest request = mock(HttpServletRequest.class);
        when(request.getRequestURI()).thenReturn(uri);
        when(request.getRemoteAddr()).thenReturn("127.0.0.1");
        return request;
    }

    @Test
    void malformedRequestBodyReturns400NotUnhandled() {
        ResponseEntity<ApiError> response = handler.handleMalformedRequest(
                new HttpMessageNotReadableException("bad body", (HttpInputMessage) null), requestTo("/api/exercises"));
        assertEquals(400, response.getStatusCode().value());
        assertEquals(400, response.getBody().status());
    }

    @Test
    void dataAccessExceptionReturns503NotUnhandled() {
        ResponseEntity<ApiError> response = handler.handleDataAccess(
                new DataAccessResourceFailureException("db unreachable"), requestTo("/api/exercises"));
        assertEquals(503, response.getStatusCode().value());
        assertEquals(503, response.getBody().status());
    }

    @Test
    void unexpectedExceptionCatchAllReturns500NotUnhandled() {
        ResponseEntity<ApiError> response =
                handler.handleUnexpected(new RuntimeException("anything else"), requestTo("/api/exercises"));
        assertEquals(500, response.getStatusCode().value());
        assertEquals(500, response.getBody().status());
    }

    @Test
    void unauthorizedExceptionStillReturns401() {
        // The one intentional 401: a genuinely expired/invalid session. Everything else routes
        // through the handlers above instead, so this stays the sole trigger for a forced logout.
        ResponseEntity<ApiError> response = handler.handleUnauthorized(new UnauthorizedException("expired"));
        assertEquals(401, response.getStatusCode().value());
        assertEquals(401, response.getBody().status());
    }

    @Test
    void nonRegistrationRouteFailuresNeverTouchTheAuditService() {
        handler.handleMalformedRequest(new HttpMessageNotReadableException("bad", (HttpInputMessage) null),
                requestTo("/api/exercises"));
        handler.handleDataAccess(new DataAccessResourceFailureException("db down"), requestTo("/api/exercises"));
        handler.handleUnexpected(new RuntimeException("boom"), requestTo("/api/exercises"));

        verifyNoInteractions(auditService);
    }

    @Test
    void malformedRegistrationRequestIsRecordedAsUnexpectedError() {
        handler.handleMalformedRequest(new HttpMessageNotReadableException("bad body", (HttpInputMessage) null),
                requestTo("/api/auth/register"));

        verify(auditService).record(eq("unknown"), eq(RegistrationEventType.UNEXPECTED_ERROR),
                contains("Malformed request body"), eq("127.0.0.1"));
    }

    @Test
    void unhandledExceptionOnConfirmEmailIsRecordedWithItsRealCause() {
        handler.handleUnexpected(new IllegalStateException("something broke"), requestTo("/api/auth/confirm-email"));

        verify(auditService).record(eq("unknown"), eq(RegistrationEventType.UNEXPECTED_ERROR),
                contains("something broke"), eq("127.0.0.1"));
    }

    @Test
    void aFailureWhileRecordingTheAuditEventNeverEscapesTheHandler() {
        doThrow(new RuntimeException("db also down")).when(auditService)
                .record(anyString(), eq(RegistrationEventType.UNEXPECTED_ERROR), anyString(), anyString());

        // Must still return the normal 503 response, not let the audit-recording failure
        // propagate and defeat the entire point of this handler (see class comment) -- if it did,
        // this call itself would throw instead of returning.
        ResponseEntity<ApiError> response = handler.handleDataAccess(
                new DataAccessResourceFailureException("db unreachable"), requestTo("/api/auth/resend-code"));

        assertEquals(503, response.getStatusCode().value());
    }
}
