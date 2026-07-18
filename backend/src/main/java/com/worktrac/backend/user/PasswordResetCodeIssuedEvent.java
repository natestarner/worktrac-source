package com.worktrac.backend.user;

// Published once a reset code is generated and persisted, instead of PasswordResetService
// calling EmailService directly -- decouples the slow, external ACS send from the transaction
// that issues the code. See RegistrationEmailEventListener.
public record PasswordResetCodeIssuedEvent(String email, String rawCode) {
}
