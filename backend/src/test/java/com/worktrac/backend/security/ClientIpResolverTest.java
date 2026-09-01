package com.worktrac.backend.security;

import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;

import static org.junit.jupiter.api.Assertions.assertEquals;

// No Spring context: this class's whole contract is "which token does it pick out of a raw
// X-Forwarded-For header", independent of any filter chain or forward-headers-strategy setting.
class ClientIpResolverTest {

    private MockHttpServletRequest requestWithForwardedFor(String headerValue) {
        MockHttpServletRequest request = new MockHttpServletRequest("POST", "/api/auth/login");
        request.setRemoteAddr("10.244.0.1"); // stand-in for ACA's own internal ingress hop
        if (headerValue != null) {
            request.addHeader("X-Forwarded-For", headerValue);
        }
        return request;
    }

    @Test
    void resolvesTheOnlyEntryWhenThereIsJustOne() {
        assertEquals("203.0.113.5", ClientIpResolver.resolveClientIp(requestWithForwardedFor("203.0.113.5")));
    }

    // The core of the fix: ACA appends its own observed IP as the LAST entry rather than replacing
    // whatever a caller already sent. Trusting anything but that last entry lets an external caller
    // pick whichever bucket they land in.
    @Test
    void takesTheLastEntryNotTheFirstWhenAcaHasAppendedToASpoofedHeader() {
        assertEquals("8.8.8.8", ClientIpResolver.resolveClientIp(requestWithForwardedFor("9.9.9.9, 8.8.8.8")));
    }

    @Test
    void toleratesExtraWhitespaceAroundEntries() {
        assertEquals("8.8.8.8", ClientIpResolver.resolveClientIp(requestWithForwardedFor("9.9.9.9 ,  8.8.8.8  ")));
    }

    // A trailing comma (or other malformed tail) must not resolve to an empty string -- scan
    // backward past blanks rather than blindly taking whatever follows the last comma.
    @Test
    void skipsTrailingEmptyEntries() {
        assertEquals("8.8.8.8", ClientIpResolver.resolveClientIp(requestWithForwardedFor("9.9.9.9, 8.8.8.8,")));
    }

    @Test
    void fallsBackToRemoteAddrWhenTheHeaderIsAbsent() {
        assertEquals("10.244.0.1", ClientIpResolver.resolveClientIp(requestWithForwardedFor(null)));
    }
}
