package com.worktrac.backend.registrationaudit;

// Published by RegistrationAuditService alongside persisting an alertable event -- consumed by
// AdminAlertEventListener, which checks the current RegistrationAlertSettings toggle for this
// event's category before actually sending an admin alert email. Kept separate from the
// persisted RegistrationEvent record itself so "record what happened" and "decide whether to
// alert someone about it" stay two independent concerns.
public record RegistrationAlertEvent(RegistrationEventType eventType, String email, String detail) {
}
