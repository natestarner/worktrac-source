package com.worktrac.backend.admin;

public record AdminRegistrationAlertSettingsDto(
        boolean alertOnRegistrationConfirmed,
        boolean alertOnSendFailure,
        boolean alertOnDeliveryFailure) {
}
