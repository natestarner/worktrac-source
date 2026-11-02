package com.worktrac.backend.user;

import org.springframework.data.repository.query.Param;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.jpa.repository.Lock;
import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;

public interface PasswordResetCodeRepository extends JpaRepository<PasswordResetCode, Long> {

    Optional<PasswordResetCode> findByEmail(String email);

    // ⚠️ PESSIMISTIC WRITE LOCK (SQL Server: WITH (UPDLOCK, HOLDLOCK, ROWLOCK)), held until the
    // caller's transaction ends. The attempt ceiling on this row is read, compared and incremented in
    // Java; without the lock, parallel attempts -- several replicas, or one attacker with many
    // connections -- all read the same count, all get a BCrypt comparison, and overwrite each
    // other's increments, so the ceiling never fires. With it they take turns, and the count is
    // exact. Only for the attempt-checking paths: it serializes concurrent requests for ONE row.
    // SecurityCounterConcurrencyTest is the pin.
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select c from PasswordResetCode c where c.email = :email")
    Optional<PasswordResetCode> findByEmailForUpdate(@Param("email") String email);

    void deleteByEmail(String email);
}
