package com.worktrac.backend.user;

import org.springframework.data.jpa.repository.Lock;
import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.Optional;

public interface PendingRegistrationRepository extends JpaRepository<PendingRegistration, Long> {

    Optional<PendingRegistration> findByEmail(String email);

    // ⚠️ PESSIMISTIC WRITE LOCK (SQL Server: WITH (UPDLOCK, HOLDLOCK, ROWLOCK)), held until the
    // caller's transaction ends. The attempt ceiling on this row is read, compared and incremented in
    // Java; without the lock, parallel attempts -- several replicas, or one attacker with many
    // connections -- all read the same count, all get a BCrypt comparison, and overwrite each
    // other's increments, so the ceiling never fires. With it they take turns, and the count is
    // exact. Only for the attempt-checking paths: it serializes concurrent requests for ONE row.
    // SecurityCounterConcurrencyTest is the pin.
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select p from PendingRegistration p where p.email = :email")
    Optional<PendingRegistration> findByEmailForUpdate(@Param("email") String email);

    void deleteByEmail(String email);

    // Admin-only test-data cleanup (see TestDataCleanupService).
    long countByEmailLike(String pattern);

    // Genuine single-statement bulk delete -- see PersonRepository.deleteByAccountIdIn's comment
    // for why TestDataCleanupService needs this instead of a derived deleteByEmailLike (which
    // Spring Data JPA would implement by loading and removing every matching row one at a time).
    @Modifying
    @Query("DELETE FROM PendingRegistration p WHERE p.email LIKE :pattern")
    void deleteByEmailLikeBulk(@Param("pattern") String pattern);
}
