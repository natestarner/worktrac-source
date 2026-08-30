package com.worktrac.backend.contact;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.Instant;
import java.util.List;

public interface ContactMessageRepository extends JpaRepository<ContactMessage, Long> {

    // Duplicate suppression. Scoped to the submitting user (not the account) because two people in
    // one household writing the same short subject is a coincidence, not a resubmit.
    boolean existsByUser_IdAndSubjectAndMessageAndCreatedAtAfter(Long userId, String subject, String message,
                                                                  Instant after);

    // Admin read. Bounded rather than paged for the same reason as the registration-events feed:
    // this is a low-volume table read by one person, and an unbounded findAll on a growing table is
    // the thing that eventually breaks.
    List<ContactMessage> findTop500ByOrderByCreatedAtDesc();

    // How many submissions a household has. Used by the deletion tests to prove the FK case below
    // is actually being exercised rather than passing vacuously.
    long countByAccount_Id(Long accountId);

    // Used by BOTH TestDataCleanupService and AccountDeletionService -- contact_messages holds
    // NO ACTION FKs to accounts, users and people, so it has to be cleared before any of them in
    // either path. It was in the cleanup path only for a while, which is exactly why a household
    // that had written in could not delete its own account.
    //
    // A bulk JPQL statement rather than a derived deleteByAccount_Id, for the same reason every
    // other repository there uses one: the derived form loads and removes entities one at a time,
    // which is what made the cleanup exceed the frontend timeout once lower had accumulated
    // hundreds of e2e accounts.
    @Modifying
    @Query("DELETE FROM ContactMessage c WHERE c.account.id IN :accountIds")
    void deleteByAccountIdIn(@Param("accountIds") List<Long> accountIds);
}
