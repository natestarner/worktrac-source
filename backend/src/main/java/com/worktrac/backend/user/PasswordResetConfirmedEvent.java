package com.worktrac.backend.user;

// Published once a password reset is confirmed and the user's password is updated, instead of
// PasswordResetService calling EmailService directly -- decouples the slow, external ACS send
// from the transaction that updates the password. See RegistrationEmailEventListener.
public record PasswordResetConfirmedEvent(String email) {
}
