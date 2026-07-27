package com.worktrac.backend.common;

import org.junit.jupiter.api.Test;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.http.HttpInputMessage;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;

import static org.junit.jupiter.api.Assertions.assertEquals;

// Pure unit tests of the handler methods -- no Spring context needed, since each method is just
// (exception in, ResponseEntity out). What matters here: NONE of these handlers let their
// exception escape unhandled, because an escaped exception triggers the servlet container's
// /error re-dispatch, which re-runs the stateless security chain as anonymous and turns even a
// benign failure into a 401 that force-logs-out an otherwise-valid session (see the SecurityConfig
// comment on exceptionHandling, and the real-request regression test in LiveSetErrorResponseTest).
class GlobalExceptionHandlerTest {

    private final GlobalExceptionHandler handler = new GlobalExceptionHandler();

    @Test
    void malformedRequestBodyReturns400NotUnhandled() {
        ResponseEntity<ApiError> response =
                handler.handleMalformedRequest(new HttpMessageNotReadableException("bad body", (HttpInputMessage) null));
        assertEquals(400, response.getStatusCode().value());
        assertEquals(400, response.getBody().status());
    }

    @Test
    void dataAccessExceptionReturns503NotUnhandled() {
        ResponseEntity<ApiError> response =
                handler.handleDataAccess(new DataAccessResourceFailureException("db unreachable"));
        assertEquals(503, response.getStatusCode().value());
        assertEquals(503, response.getBody().status());
    }

    @Test
    void unexpectedExceptionCatchAllReturns500NotUnhandled() {
        ResponseEntity<ApiError> response = handler.handleUnexpected(new RuntimeException("anything else"));
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
}
