package com.worktrac.backend.user.dto;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

// The two name caps are sized to the tables CONFIRMATION writes into, not to the
// pending_registrations columns these values first land in. Those are both NVARCHAR(255), while
// accounts.name is NVARCHAR(200) and people.name is NVARCHAR(100) -- so a 150-character person
// name used to be accepted here, written to the pending row, and emailed a verification code,
// only for confirm-email to fail forever on the truncation. The person was left permanently
// stuck: a pending registration they could never confirm, and re-registering just repeated it.
// Rejecting at this end turns that into an honest 400 on the form they are looking at.
//
// password gets a maximum as well as a minimum, but note LoginRequest deliberately does NOT --
// adding one there would lock out anyone who already registered with something longer.
public record RegisterRequest(
        @Size(max = 200, message = "must be 200 characters or fewer") String accountName,

        @NotBlank @Email @Size(max = 255, message = "must be 255 characters or fewer") String email,

        @NotBlank @Size(min = 8, max = 200, message = "must be between 8 and 200 characters") String password,

        @NotBlank @Size(max = 100, message = "must be 100 characters or fewer") String personName
) {
}
