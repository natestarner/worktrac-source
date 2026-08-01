package com.worktrac.backend.admin;

// Counts of what matches the e2e test-data pattern right now -- returned both by the preview
// endpoint (nothing deleted yet) and by the delete endpoint itself (what was just deleted), so
// the admin portal can show the same shape before and after confirming.
public record AdminTestDataPreviewDto(
        long accountCount,
        long registrationEventCount,
        long pendingRegistrationCount) {
}
