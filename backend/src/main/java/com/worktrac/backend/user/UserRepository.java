package com.worktrac.backend.user;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

import java.time.Instant;
import java.util.List;
import java.util.Optional;

public interface UserRepository extends JpaRepository<User, Long> {

    Optional<User> findByEmail(String email);

    boolean existsByEmail(String email);

    void deleteByAccount_Id(Long accountId);

    long countByCreatedAtAfter(Instant cutoff);

    // Admin-only: [accountId, email] / [accountId, role] pairs across ALL accounts, for
    // the admin portal's Accounts grid. Every account has exactly one User today
    // (registration only ever creates one), so this is unambiguous; if that ever
    // changes, a later row for the same account simply wins in the map built from it.
    @Query("SELECT u.account.id, u.email FROM User u")
    List<Object[]> emailGroupedByAccount();

    @Query("SELECT u.account.id, u.role FROM User u")
    List<Object[]> roleGroupedByAccount();
}
