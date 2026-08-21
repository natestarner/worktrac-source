package com.worktrac.backend.contact;

// PENDING is the stored default rather than null so that "the async alert listener never ran at
// all" is visibly different from "it ran and succeeded" -- see registration-and-email.md. A row
// sitting at PENDING long after created_at means nobody was actually notified, which is exactly
// the blind spot docs/incidents/2026-08-01-email-blind-spots-and-delete-timeout.md was about.
public enum ContactAlertStatus {
    PENDING,
    SENT,
    FAILED
}
