package com.worktrac.backend.contact;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.Size;

// A narrow, typed record rather than a free-text blob, so the client cannot smuggle arbitrary
// content into the admin's inbox under the guise of "diagnostics". Every field is bounded.
//
// Deliberately absent: correlationId, userAgent and ipAddress. Those are read server-side from the
// request, so the stored correlation id is guaranteed to be the one the backend actually logged
// against -- a body-supplied value could point triage at somebody else's session.
//
// clientError is the last render-time error ErrorBoundary caught. It is stored and displayed, never
// written into a log line or the alert email's subject.
//
// bootFailure is the same idea one layer lower: what boot-watchdog.js recorded when the app failed
// to start at all. It cannot be folded into clientError -- that one is written by a React error
// boundary, so it only exists when React was alive enough to catch something, and a boot that never
// rendered produces nothing there. Same handling: stored and displayed, never logged or emailed.
public record ContactDiagnostics(
        @Size(max = 40) String appBuild,
        @Size(max = 80) String screen,
        Boolean wasOnline,
        @Min(0) @Max(9999) Integer unsyncedWrites,
        @Size(max = 2000) String clientError,
        @Size(max = 2000) String bootFailure) {
}
