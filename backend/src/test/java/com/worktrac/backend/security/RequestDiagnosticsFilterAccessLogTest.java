package com.worktrac.backend.security;

import ch.qos.logback.classic.spi.ILoggingEvent;
import com.worktrac.backend.support.LogCaptor;
import jakarta.servlet.FilterChain;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.parallel.Isolated;
import org.slf4j.MDC;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.mock;

// The lower-only access line: the evidence for "what keeps waking lower". @Isolated for the reason
// LogCaptor's header gives -- another Spring context booting concurrently can detach its appender.
@Isolated
class RequestDiagnosticsFilterAccessLogTest {

    @AfterEach
    void clearMdc() {
        MDC.clear();
    }

    private static MockHttpServletRequest request(String method, String uri) {
        MockHttpServletRequest request = new MockHttpServletRequest(method, uri);
        request.addHeader("X-Forwarded-For", "203.0.113.7");
        return request;
    }

    private static List<String> accessLines(RequestDiagnosticsFilter filter, MockHttpServletRequest request,
                                            FilterChain chain) throws Exception {
        try (LogCaptor captor = new LogCaptor(RequestDiagnosticsFilter.class)) {
            try {
                filter.doFilter(request, new MockHttpServletResponse(), chain);
            } catch (RuntimeException ignored) {
                // The throwing-chain test asserts the throw itself; here only the log matters.
            }
            return captor.events().stream()
                    .map(ILoggingEvent::getFormattedMessage)
                    .filter(m -> m.startsWith("access "))
                    .toList();
        }
    }

    private static List<String> accessLines(RequestDiagnosticsFilter filter, MockHttpServletRequest request)
            throws Exception {
        return accessLines(filter, request, mock(FilterChain.class));
    }

    // Production keeps real traffic; a line per request there is noise, so the default is silence.
    @Test
    void logsNothingUnlessEnabled() throws Exception {
        assertTrue(accessLines(new RequestDiagnosticsFilter(), request("GET", "/api/exercises")).isEmpty());
    }

    @Test
    void namesTheCallerOfEveryRequestWhenEnabled() throws Exception {
        MockHttpServletRequest request = request("GET", "/api/history/months");
        request.addHeader("User-Agent", "Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)");
        request.addHeader("Origin", "https://app-lower.huddle.fitness");

        List<String> lines = accessLines(new RequestDiagnosticsFilter(true), request);

        assertEquals(List.of("access GET /api/history/months -> 200 (0 ms) ip=203.0.113.7"
                + " ua=\"Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)\" origin=https://app-lower.huddle.fitness"),
                lines.stream().map(l -> l.replaceAll("\\(\\d+ ms\\)", "(0 ms)")).toList());
    }

    // An open tab is found by WHOSE account it is signed into. JwtAuthenticationFilter sets uid
    // inside the chain, so the line has to be written before this filter clears the MDC.
    @Test
    void theLineCarriesTheUserIdResolvedInsideTheChain() throws Exception {
        FilterChain chain = mock(FilterChain.class);
        doAnswer(invocation -> {
            MDC.put(RequestDiagnosticsFilter.USER_ID_MDC_KEY, "42");
            return null;
        }).when(chain).doFilter(any(), any());

        try (LogCaptor captor = new LogCaptor(RequestDiagnosticsFilter.class)) {
            new RequestDiagnosticsFilter(true).doFilter(request("GET", "/api/auth/me"),
                    new MockHttpServletResponse(), chain);

            ILoggingEvent access = captor.events().stream()
                    .filter(e -> e.getFormattedMessage().startsWith("access ")).findFirst().orElseThrow();
            assertEquals("42", access.getMDCPropertyMap().get(RequestDiagnosticsFilter.USER_ID_MDC_KEY));
        }
    }

    // Reset and verification links carry their codes in the query string, and a Referer can be one.
    @Test
    void neverLogsAQueryStringOrAFullReferer() throws Exception {
        MockHttpServletRequest request = request("GET", "/api/auth/invite/preview");
        request.setQueryString("token=secret-invite-token");
        request.addHeader("Referer", "https://app-lower.huddle.fitness/accept-invite?token=secret-invite-token");

        String line = accessLines(new RequestDiagnosticsFilter(true), request).get(0);

        assertFalse(line.contains("secret-invite-token"), line);
        assertTrue(line.endsWith("origin=https://app-lower.huddle.fitness"), line);
    }

    // The kubelet's probes hit the container every few seconds while it is up and never wake it.
    // Anything else on the health endpoint (an uptime monitor) is precisely a caller worth finding.
    @Test
    void skipsTheKubeletsOwnProbesButNotOtherHealthCallers() throws Exception {
        RequestDiagnosticsFilter filter = new RequestDiagnosticsFilter(true);

        MockHttpServletRequest probe = request("GET", "/actuator/health");
        probe.addHeader("User-Agent", "kube-probe/1.30");
        assertTrue(accessLines(filter, probe).isEmpty());

        MockHttpServletRequest monitor = request("GET", "/actuator/health");
        monitor.addHeader("User-Agent", "UptimeRobot/2.0");
        assertEquals(1, accessLines(filter, monitor).size());
    }

    // A scanner controls the path and every header. A newline would forge a second log entry; a
    // quote would end ua="..." early.
    @Test
    void cannotBeUsedToForgeALogLine() throws Exception {
        MockHttpServletRequest request = request("GET", "/.env");
        request.addHeader("User-Agent", "bot\n2026-10-29 INFO forged \"line\"");

        String line = accessLines(new RequestDiagnosticsFilter(true), request).get(0);

        assertFalse(line.contains("\n"), line);
        assertTrue(line.contains("ua=\"bot?2026-10-29 INFO forged ?line?\""), line);
        assertTrue(line.contains("origin=-"), line);
    }

    @Test
    void stillLogsWhenTheChainThrows() throws Exception {
        FilterChain exploding = mock(FilterChain.class);
        doAnswer(invocation -> {
            throw new RuntimeException("downstream blew up");
        }).when(exploding).doFilter(any(), any());

        assertThrows(RuntimeException.class, () -> new RequestDiagnosticsFilter(true)
                .doFilter(request("POST", "/api/sets"), new MockHttpServletResponse(), exploding));
        assertEquals(1, accessLines(new RequestDiagnosticsFilter(true), request("POST", "/api/sets"), exploding).size());
    }
}
