package com.worktrac.backend.user;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.Optional;

public interface PendingRegistrationRepository extends JpaRepository<PendingRegistration, Long> {

    Optional<PendingRegistration> findByEmail(String email);

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
