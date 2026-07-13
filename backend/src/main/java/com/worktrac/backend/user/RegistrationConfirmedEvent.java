package com.worktrac.backend.user;

// Published once a registration is confirmed and the account is created, instead of
// RegistrationService calling EmailService directly -- decouples the slow, external ACS send
// from the transaction that creates the account. See RegistrationEmailEventListener.
public record RegistrationConfirmedEvent(String email) {
}
