package com.worktrac.backend.registrationaudit;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Collection;
import java.util.List;
import java.util.Optional;

public interface RegistrationEventRepository extends JpaRepository<RegistrationEvent, Long> {

    // Bounded, not an unbounded findAll() -- the admin Activity feed shows recent history, not
    // the entire lifetime of the table.
    List<RegistrationEvent> findTop500ByOrderByCreatedAtDesc();

    // Backs the Pending tab's per-row "last known email status" -- the most recent send or
    // delivery outcome recorded for that email, regardless of which of the two levels it came
    // from.
    Optional<RegistrationEvent> findFirstByEmailAndEventTypeInOrderByCreatedAtDesc(
            String email, Collection<RegistrationEventType> eventTypes);

    // Admin-only test-data cleanup (see TestDataCleanupService). Not tied to account_id (this
    // table has no such column -- events persist even after the account they describe is
    // deleted), so this is the only way to clean these rows up alongside the accounts.
    long countByEmailLike(String pattern);

    long deleteByEmailLike(String pattern);
}
