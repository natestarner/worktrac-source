package com.worktrac.backend.contact;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

// Strict validation is safe here in a way it would NOT be on a durable write. backend-core.md's
// "validation strictness is a durability decision" rule applies only to offline-capable writes,
// where a 400 permanently discards something the outbox queued through an entire outage. This is a
// Tier-3 gated write with no outbox behind it -- the frontend never queues it, so a rejection is
// visible to the person immediately, with their draft still on screen.
//
// The minimum length on `message` is deliberate: a bug report of "it broke" costs a round trip to
// triage, and the field's own helper text asks for what happened.
public record ContactRequest(
        @NotNull ContactCategory category,
        @NotBlank @Size(max = 150) String subject,
        @NotBlank @Size(min = 10, max = 4000) String message,
        Long personId,
        @Valid ContactDiagnostics diagnostics) {
}
