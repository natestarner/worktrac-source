package com.worktrac.backend.security;

import com.worktrac.backend.common.PayloadTooLargeException;
import com.worktrac.backend.config.RequestLimitProperties;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ReadListener;
import jakarta.servlet.ServletException;
import jakarta.servlet.ServletInputStream;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletRequestWrapper;
import jakarta.servlet.http.HttpServletResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.util.regex.Pattern;

// Bounds the number of bytes any request body may carry. Registered FIRST in the chain (ahead of
// RequestDiagnosticsFilter) so an oversized body is refused before anything reads it -- before the
// rest of the security chain, before any controller, and before Jackson.
//
// TWO CHECKS, and both are load-bearing:
//
//   1. Content-Length, when the client declares one. Cheap, and rejects before a single body byte
//      is read.
//   2. A counting wrapper around the input stream, for when it does not. A Content-Length header
//      is trivially omitted by sending Transfer-Encoding: chunked, so a header check ALONE is not
//      a limit -- it is a suggestion. The wrapper is what makes the cap real.
//
// The 413 is written with response.setStatus, never sendError. sendError triggers the servlet
// container's internal forward to /error, which re-runs the whole (stateless) security filter
// chain for that forwarded dispatch as an ANONYMOUS request -- silently turning the response into
// a 401 that the frontend reads as "session invalid" and logs the user out. SecurityConfig's
// exceptionHandling carries the same rule and the same reasoning.
public class RequestSizeLimitFilter extends OncePerRequestFilter {

    private static final Logger log = LoggerFactory.getLogger(RequestSizeLimitFilter.class);

    // POST /api/people/{personId}/import and .../import/preview -- the only routes that carry a
    // whole CSV. Matched with a regex rather than Spring's path matching because this filter runs
    // before any handler mapping has resolved. A [0-9] class rather than \d purely for readability.
    private static final Pattern IMPORT_PATH = Pattern.compile("^/api/people/[0-9]+/import(/preview)?$");

    private final RequestLimitProperties properties;

    public RequestSizeLimitFilter(RequestLimitProperties properties) {
        this.properties = properties;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response,
                                     FilterChain filterChain) throws ServletException, IOException {
        long maxBytes = maxBytesFor(request);

        long declaredLength = request.getContentLengthLong();
        if (declaredLength > maxBytes) {
            reject(request, response, declaredLength, maxBytes);
            return;
        }

        filterChain.doFilter(new LimitedBodyRequest(request, maxBytes), response);
    }

    private long maxBytesFor(HttpServletRequest request) {
        return IMPORT_PATH.matcher(request.getRequestURI()).matches()
                ? properties.getImportMaxBytes()
                : properties.getDefaultMaxBytes();
    }

    private void reject(HttpServletRequest request, HttpServletResponse response, long declared, long maxBytes)
            throws IOException {
        log.warn("Rejected {} {} from ip {}: body of {} bytes exceeds the {} byte limit",
                request.getMethod(), request.getRequestURI(), request.getRemoteAddr(), declared, maxBytes);
        response.setStatus(HttpServletResponse.SC_REQUEST_ENTITY_TOO_LARGE);
        response.setContentType("application/json");
        response.getWriter().write("{\"status\":413,\"message\":\"That request is too large.\"}");
    }

    // Wraps the body so reading past the cap throws instead of returning bytes. The throw surfaces
    // through Jackson as an HttpMessageNotReadableException whose cause is our
    // PayloadTooLargeException; GlobalExceptionHandler unwraps that back into an honest 413 rather
    // than reporting it as a generic malformed body.
    private static final class LimitedBodyRequest extends HttpServletRequestWrapper {

        private final long maxBytes;

        private LimitedBodyRequest(HttpServletRequest request, long maxBytes) {
            super(request);
            this.maxBytes = maxBytes;
        }

        @Override
        public ServletInputStream getInputStream() throws IOException {
            return new CountingServletInputStream(super.getInputStream(), maxBytes);
        }
    }

    private static final class CountingServletInputStream extends ServletInputStream {

        private final ServletInputStream delegate;
        private final long maxBytes;
        private long read;

        private CountingServletInputStream(ServletInputStream delegate, long maxBytes) {
            this.delegate = delegate;
            this.maxBytes = maxBytes;
        }

        private void count(long justRead) {
            if (justRead <= 0) {
                return;
            }
            read += justRead;
            if (read > maxBytes) {
                throw new PayloadTooLargeException("Request body exceeded the " + maxBytes + " byte limit");
            }
        }

        @Override
        public int read() throws IOException {
            int value = delegate.read();
            count(value == -1 ? 0 : 1);
            return value;
        }

        @Override
        public int read(byte[] b, int off, int len) throws IOException {
            int justRead = delegate.read(b, off, len);
            count(justRead);
            return justRead;
        }

        @Override
        public boolean isFinished() {
            return delegate.isFinished();
        }

        @Override
        public boolean isReady() {
            return delegate.isReady();
        }

        @Override
        public void setReadListener(ReadListener readListener) {
            delegate.setReadListener(readListener);
        }

        @Override
        public void close() throws IOException {
            delegate.close();
        }
    }
}
