package com.worktrac.backend.contact;

// Published by ContactMessageService AFTER the message row has committed, and consumed by
// ContactEmailEventListener on the async email executor. The originating service never calls
// EmailService directly -- the same rule the registration pipeline follows, so a slow or failing
// Azure Communication Services call can never roll back a message the person already sent.
//
// Carries the id (not the entity) because the listener runs on a different thread after the
// originating transaction closed, so a lazy association would be detached.
public record ContactMessageReceivedEvent(Long contactMessageId, ContactCategory category, String subject,
                                           String message, String submitterEmail, String correlationId) {
}
