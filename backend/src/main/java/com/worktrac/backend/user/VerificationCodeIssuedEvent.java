package com.worktrac.backend.user;

// Published once a verification code is generated and persisted, instead of RegistrationService
// calling EmailService directly -- decouples the slow, external ACS send from the transaction
// that issues the code. See RegistrationEmailEventListener.
public record VerificationCodeIssuedEvent(String email, String rawCode) {
}
