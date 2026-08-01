package com.worktrac.backend.user;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;

public interface PendingRegistrationRepository extends JpaRepository<PendingRegistration, Long> {

    Optional<PendingRegistration> findByEmail(String email);

    void deleteByEmail(String email);

    // Admin-only test-data cleanup (see TestDataCleanupService).
    long countByEmailLike(String pattern);

    long deleteByEmailLike(String pattern);
}
