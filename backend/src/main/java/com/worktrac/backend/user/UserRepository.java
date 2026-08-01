package com.worktrac.backend.user;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.Instant;
import java.util.List;
import java.util.Optional;

public interface UserRepository extends JpaRepository<User, Long> {

    Optional<User> findByEmail(String email);

    boolean existsByEmail(String email);

    void deleteByAccount_Id(Long accountId);

    long countByCreatedAtAfter(Instant cutoff);

    // Admin-only test-data cleanup: every account ID whose login email matches the e2e
    // Playwright suite's exact pattern (see TestDataCleanupService for the full pattern string
    // and why it's safe to match this broadly). IDs only, not full User entities -- this is the
    // list TestDataCleanupService fans out to every other table's own bulk delete.
    @Query("SELECT u.account.id FROM User u WHERE u.email LIKE :pattern")
    List<Long> findAccountIdsByEmailLike(@Param("pattern") String pattern);

    // Genuine single-statement bulk delete for TestDataCleanupService -- see
    // PersonRepository.deleteByAccountIdIn's comment for why this is safe and preferred over the
    // derived, entity-at-a-time deleteByAccount_Id above for that specific caller.
    @Modifying
    @Query("DELETE FROM User u WHERE u.account.id IN :accountIds")
    void deleteByAccountIdIn(@Param("accountIds") List<Long> accountIds);

    // Admin-only: [accountId, email] / [accountId, role] pairs across ALL accounts, for
    // the admin portal's Accounts grid. Every account has exactly one User today
    // (registration only ever creates one), so this is unambiguous; if that ever
    // changes, a later row for the same account simply wins in the map built from it.
    @Query("SELECT u.account.id, u.email FROM User u")
    List<Object[]> emailGroupedByAccount();

    @Query("SELECT u.account.id, u.role FROM User u")
    List<Object[]> roleGroupedByAccount();
}
