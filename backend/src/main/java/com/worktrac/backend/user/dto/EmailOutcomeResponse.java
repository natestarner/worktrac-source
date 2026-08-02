package com.worktrac.backend.user.dto;

// Backs GET /api/auth/test/email-outcome (TestSupportController) -- lets the e2e live-email
// canary spec (the one spec that deliberately still triggers a real ACS send) verify the real
// outcome, not just that the UI reached /app/log, which would look identical whether the send
// succeeded, failed, or was no-op'd. status is "SENT" or "FAILED", derived from whichever of
// VERIFICATION_EMAIL_SENT/VERIFICATION_EMAIL_FAILED was most recently recorded for the email.
public record EmailOutcomeResponse(String status, String messageId, String detail) {
}
