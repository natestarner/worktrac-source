package com.worktrac.backend.registrationaudit;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;

// The settings row (id = 1) is seeded by V45__create_registration_alert_settings.sql and never
// deleted -- get()/update() can rely on it always existing rather than defensively creating it.
@Service
public class RegistrationAlertSettingsService {

    private static final long SETTINGS_ID = 1L;

    private final RegistrationAlertSettingsRepository repository;
    private final Clock clock;

    public RegistrationAlertSettingsService(RegistrationAlertSettingsRepository repository, Clock clock) {
        this.repository = repository;
        this.clock = clock;
    }

    @Transactional(readOnly = true)
    public RegistrationAlertSettings get() {
        return repository.findById(SETTINGS_ID).orElseThrow(() ->
                new IllegalStateException("registration_alert_settings row (id=1) is missing -- V45 migration seed"));
    }

    @Transactional
    public RegistrationAlertSettings update(boolean alertOnRegistrationConfirmed, boolean alertOnSendFailure,
                                             boolean alertOnDeliveryFailure, boolean alertOnContactMessage) {
        RegistrationAlertSettings settings = get();
        settings.setAlertOnRegistrationConfirmed(alertOnRegistrationConfirmed);
        settings.setAlertOnSendFailure(alertOnSendFailure);
        settings.setAlertOnDeliveryFailure(alertOnDeliveryFailure);
        settings.setAlertOnContactMessage(alertOnContactMessage);
        settings.setUpdatedAt(clock.instant());
        return repository.save(settings);
    }
}
