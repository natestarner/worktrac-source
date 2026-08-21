package com.worktrac.backend.contact;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;

// Records the outcome of the admin alert send onto the message row.
//
// REQUIRES_NEW is load-bearing, for the same reason RegistrationAuditService.record is: this runs
// from an @Async listener after the originating transaction has already committed, so it needs a
// transaction of its own rather than silently joining nothing -- and a failure here must not be
// able to touch anything else.
@Service
public class ContactAlertStatusService {

    private final ContactMessageRepository repository;
    private final Clock clock;

    public ContactAlertStatusService(ContactMessageRepository repository, Clock clock) {
        this.repository = repository;
        this.clock = clock;
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void recordSent(Long contactMessageId, String messageId) {
        update(contactMessageId, ContactAlertStatus.SENT, messageId, null);
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void recordFailed(Long contactMessageId, String detail) {
        update(contactMessageId, ContactAlertStatus.FAILED, null, truncate(detail, 1000));
    }

    private void update(Long contactMessageId, ContactAlertStatus status, String messageId, String detail) {
        repository.findById(contactMessageId).ifPresent(contactMessage -> {
            contactMessage.setAlertStatus(status);
            contactMessage.setAlertMessageId(messageId);
            contactMessage.setAlertDetail(detail);
            contactMessage.setAlertUpdatedAt(clock.instant());
            repository.save(contactMessage);
        });
    }

    private String truncate(String value, int maxLength) {
        if (value == null) {
            return null;
        }
        return value.length() <= maxLength ? value : value.substring(0, maxLength);
    }
}
