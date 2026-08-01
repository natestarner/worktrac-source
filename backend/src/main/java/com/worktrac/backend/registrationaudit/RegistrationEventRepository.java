package com.worktrac.backend.registrationaudit;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.Instant;
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

    // RegistrationDispatchWatchdog's candidate query: every REGISTER_STARTED in a bounded recent
    // window, to check each for a missing email-dispatch outcome.
    List<RegistrationEvent> findByEventTypeAndCreatedAtBetween(RegistrationEventType eventType, Instant from,
                                                                Instant to);

    // RegistrationDispatchWatchdog's resolution check: has this email had any of the given
    // outcome types recorded at or after its REGISTER_STARTED row's own timestamp?
    boolean existsByEmailAndEventTypeInAndCreatedAtGreaterThanEqual(String email,
                                                                     Collection<RegistrationEventType> eventTypes,
                                                                     Instant since);

    // Admin-only test-data cleanup (see TestDataCleanupService). Not tied to account_id (this
    // table has no such column -- events persist even after the account they describe is
    // deleted), so this is the only way to clean these rows up alongside the accounts.
    long countByEmailLike(String pattern);

    // Genuine single-statement bulk delete -- see PersonRepository.deleteByAccountIdIn's comment
    // for why TestDataCleanupService needs this instead of a derived deleteByEmailLike (which
    // Spring Data JPA would implement by loading and removing every matching row one at a time).
    @Modifying
    @Query("DELETE FROM RegistrationEvent e WHERE e.email LIKE :pattern")
    void deleteByEmailLikeBulk(@Param("pattern") String pattern);
}
