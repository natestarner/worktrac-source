package com.worktrac.backend.security;

import com.worktrac.backend.common.PayloadTooLargeException;
import com.worktrac.backend.config.RequestLimitProperties;
import jakarta.servlet.http.HttpServletRequest;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockFilterChain;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

import java.nio.charset.StandardCharsets;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;

// Plain unit test (no Spring context) -- the filter depends only on RequestLimitProperties, a
// simple POJO.
//
// Both paths are covered deliberately. The Content-Length check alone is NOT a limit: a client
// that sends Transfer-Encoding: chunked declares no length at all, so without the streaming check
// the cap would be advisory and the OOM this filter exists to stop would still be reachable.
class RequestSizeLimitFilterTest {

    private static final long DEFAULT_MAX = 100;
    private static final long IMPORT_MAX = 1000;

    private RequestSizeLimitFilter newFilter() {
        RequestLimitProperties properties = new RequestLimitProperties();
        properties.setDefaultMaxBytes(DEFAULT_MAX);
        properties.setImportMaxBytes(IMPORT_MAX);
        return new RequestSizeLimitFilter(properties);
    }

    private MockHttpServletRequest request(String uri, int bodyBytes) {
        MockHttpServletRequest request = new MockHttpServletRequest("POST", uri);
        request.setContent(new byte[bodyBytes]);
        request.setContentType("application/json");
        return request;
    }

    @Test
    void declaredBodyOverTheLimitIsRejectedBeforeTheChainRuns() throws Exception {
        MockHttpServletResponse response = new MockHttpServletResponse();
        MockFilterChain chain = new MockFilterChain();

        newFilter().doFilter(request("/api/auth/register", (int) DEFAULT_MAX + 1), response, chain);

        assertEquals(413, response.getStatus());
        // The whole point: the request never reached anything downstream, so nothing read the body.
        assertNull(chain.getRequest());
    }

    @Test
    void declaredBodyAtTheLimitIsAllowedThrough() throws Exception {
        MockHttpServletResponse response = new MockHttpServletResponse();
        MockFilterChain chain = new MockFilterChain();

        newFilter().doFilter(request("/api/auth/register", (int) DEFAULT_MAX), response, chain);

        assertEquals(200, response.getStatus());
        assertNotNull(chain.getRequest());
    }

    @Test
    void importRoutesGetTheLargerLimit() throws Exception {
        MockHttpServletResponse response = new MockHttpServletResponse();
        MockFilterChain chain = new MockFilterChain();

        // Comfortably over the default cap, comfortably under the import cap.
        newFilter().doFilter(request("/api/people/42/import", (int) DEFAULT_MAX + 500), response, chain);

        assertEquals(200, response.getStatus());
        assertNotNull(chain.getRequest());
    }

    @Test
    void importPreviewGetsTheLargerLimitToo() throws Exception {
        MockHttpServletResponse response = new MockHttpServletResponse();
        MockFilterChain chain = new MockFilterChain();

        newFilter().doFilter(request("/api/people/42/import/preview", (int) DEFAULT_MAX + 500), response, chain);

        assertEquals(200, response.getStatus());
        assertNotNull(chain.getRequest());
    }

    @Test
    void aPathThatMerelyLooksLikeImportDoesNotGetTheLargerLimit() throws Exception {
        MockHttpServletResponse response = new MockHttpServletResponse();
        MockFilterChain chain = new MockFilterChain();

        // The regex is anchored on purpose -- "…/imports" (the undo listing) and any suffix beyond
        // /preview must fall back to the default cap rather than inheriting import's headroom.
        newFilter().doFilter(request("/api/people/42/imports", (int) DEFAULT_MAX + 1), response, chain);

        assertEquals(413, response.getStatus());
        assertNull(chain.getRequest());
    }

    @Test
    void anUndeclaredBodyOverTheLimitIsCaughtWhileItIsBeingRead() throws Exception {
        // A chunked request: content is present but no length is declared, so the Content-Length
        // check above cannot see it. This is the bypass the counting stream exists to close.
        byte[] body = "x".repeat((int) DEFAULT_MAX + 50).getBytes(StandardCharsets.UTF_8);
        MockHttpServletRequest request = new MockHttpServletRequest("POST", "/api/auth/register") {
            @Override
            public long getContentLengthLong() {
                return -1;
            }
        };
        request.setContent(body);

        MockHttpServletResponse response = new MockHttpServletResponse();
        MockFilterChain chain = new MockFilterChain();
        newFilter().doFilter(request, response, chain);

        // It passes the header check, so the chain is entered -- the guard fires on the read.
        HttpServletRequest wrapped = (HttpServletRequest) chain.getRequest();
        assertNotNull(wrapped);
        assertThrows(PayloadTooLargeException.class, () -> wrapped.getInputStream().readAllBytes());
    }

    @Test
    void anUndeclaredBodyUnderTheLimitReadsBackIntact() throws Exception {
        byte[] body = "hello".getBytes(StandardCharsets.UTF_8);
        MockHttpServletRequest request = new MockHttpServletRequest("POST", "/api/auth/register") {
            @Override
            public long getContentLengthLong() {
                return -1;
            }
        };
        request.setContent(body);

        MockFilterChain chain = new MockFilterChain();
        newFilter().doFilter(request, new MockHttpServletResponse(), chain);

        HttpServletRequest wrapped = (HttpServletRequest) chain.getRequest();
        assertEquals("hello", new String(wrapped.getInputStream().readAllBytes(), StandardCharsets.UTF_8));
    }
}
