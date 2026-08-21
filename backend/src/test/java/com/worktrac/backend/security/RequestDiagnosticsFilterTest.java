package com.worktrac.backend.security;

import jakarta.servlet.FilterChain;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.slf4j.MDC;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.mock;

// No Spring context: this filter's whole contract is what it puts in (and takes out of) the MDC.
class RequestDiagnosticsFilterTest {

    private final RequestDiagnosticsFilter filter = new RequestDiagnosticsFilter();

    @AfterEach
    void clearMdc() {
        MDC.clear();
    }

    private MockHttpServletRequest requestWith(String correlationId) {
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/api/exercises");
        if (correlationId != null) {
            request.addHeader(RequestDiagnosticsFilter.CORRELATION_ID_HEADER, correlationId);
        }
        return request;
    }

    // Captures what the MDC held WHILE the chain was running -- asserting after doFilter returns
    // would only ever see the cleaned-up state and would pass with the MDC never being set at all.
    private String[] capturedDuringChain(MockHttpServletRequest request) throws Exception {
        String[] seen = new String[1];
        FilterChain chain = mock(FilterChain.class);
        doAnswer(invocation -> {
            seen[0] = MDC.get(RequestDiagnosticsFilter.CORRELATION_ID_MDC_KEY);
            return null;
        }).when(chain).doFilter(any(), any());

        filter.doFilter(request, new MockHttpServletResponse(), chain);
        return seen;
    }

    @Test
    void putsTheCorrelationIdInTheMdcForTheDurationOfTheRequest() throws Exception {
        assertEquals("abc-123", capturedDuringChain(requestWith("abc-123"))[0]);
    }

    // Request threads are pooled. A leaked id points triage confidently at the WRONG session, which
    // is worse than having no correlation id at all.
    @Test
    void clearsTheMdcAfterTheRequest() throws Exception {
        capturedDuringChain(requestWith("abc-123"));

        assertNull(MDC.get(RequestDiagnosticsFilter.CORRELATION_ID_MDC_KEY));
        assertNull(MDC.get(RequestDiagnosticsFilter.USER_ID_MDC_KEY));
    }

    @Test
    void clearsTheMdcEvenWhenTheChainThrows() throws Exception {
        FilterChain exploding = mock(FilterChain.class);
        doAnswer(invocation -> {
            throw new RuntimeException("downstream blew up");
        }).when(exploding).doFilter(any(), any());

        assertThrows(RuntimeException.class,
                () -> filter.doFilter(requestWith("abc-123"), new MockHttpServletResponse(), exploding));

        assertNull(MDC.get(RequestDiagnosticsFilter.CORRELATION_ID_MDC_KEY));
    }

    // A stale id left by a previous request on this pooled thread must not survive into one that
    // carries no header of its own.
    @Test
    void doesNotInheritAnIdFromAPreviousRequestOnTheSameThread() throws Exception {
        capturedDuringChain(requestWith("first-request"));

        assertNull(capturedDuringChain(requestWith(null))[0]);
    }

    @Test
    void degradesToNoIdWhenTheHeaderIsAbsentOrBlank() throws Exception {
        assertNull(capturedDuringChain(requestWith(null))[0]);
        assertNull(capturedDuringChain(requestWith("   "))[0]);
    }

    // The value ends up inside log lines, so an attacker-controlled one containing newlines could
    // otherwise forge log entries. Dropping it entirely is always safe; accepting it is not.
    @Test
    void dropsAnIdThatIsNotPlainlyAnOpaqueToken() throws Exception {
        assertNull(capturedDuringChain(requestWith("abc\ndef"))[0]);
        assertNull(capturedDuringChain(requestWith("abc def"))[0]);
        assertNull(capturedDuringChain(requestWith("<script>"))[0]);
    }

    @Test
    void acceptsTheShapeTheBrowserActuallySends() throws Exception {
        // crypto.randomUUID's output, and lib/correlationId.js's non-secure-origin fallback.
        assertEquals("0f4d2b8e-4c1a-4f9b-9a1e-2b6d3c5f7a90",
                capturedDuringChain(requestWith("0f4d2b8e-4c1a-4f9b-9a1e-2b6d3c5f7a90"))[0]);
        assertEquals("cid-m1abc-x7yz9q", capturedDuringChain(requestWith("cid-m1abc-x7yz9q"))[0]);
    }

    @Test
    void truncatesAnOverlongIdRatherThanRejectingIt() throws Exception {
        assertEquals("a".repeat(64), capturedDuringChain(requestWith("a".repeat(200)))[0]);
    }
}
