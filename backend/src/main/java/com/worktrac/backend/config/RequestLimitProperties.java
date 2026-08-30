package com.worktrac.backend.config;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

// Caps on how many bytes a request body may carry. Nothing bounded these before: Tomcat's
// maxPostSize applies ONLY to form-encoded bodies, never to application/json, so Jackson read
// whatever it was given straight into the heap. A single multi-gigabyte POST to
// /api/auth/register -- unauthenticated, permitAll, and reached before any rate limiter, since
// the limiter lives inside RegistrationService and deserialization happens first -- was enough
// to OOM the container for every household.
//
// Two tiers rather than one, because import is legitimately different in kind:
//
//   default 1 MB -- roughly 100x the largest payload the app actually produces. The biggest
//     ordinary body is a Contact Us submission (a 4000-char message plus a 2000-char captured
//     client error plus diagnostics, ~10 KB). 1 MB rather than something tighter so it also
//     comfortably clears an Azure Event Grid batch, which that service documents as up to 1 MB
//     -- the email-delivery webhook is a real caller we must not start rejecting.
//
//   import 6 MB -- CsvImportParser.MAX_BYTES is 5 MB, and the CSV travels as a JSON string, so
//     escaping plus the surrounding envelope needs headroom above the raw file size. Note the
//     parser's own check runs AFTER the whole string has been materialized, so it documents
//     intent but protects nothing; this is the cap that actually bounds memory.
@Component
@ConfigurationProperties(prefix = "app.request-limits")
public class RequestLimitProperties {

    private long defaultMaxBytes = 1024 * 1024;

    private long importMaxBytes = 6 * 1024 * 1024;

    public long getDefaultMaxBytes() {
        return defaultMaxBytes;
    }

    public void setDefaultMaxBytes(long defaultMaxBytes) {
        this.defaultMaxBytes = defaultMaxBytes;
    }

    public long getImportMaxBytes() {
        return importMaxBytes;
    }

    public void setImportMaxBytes(long importMaxBytes) {
        this.importMaxBytes = importMaxBytes;
    }
}
