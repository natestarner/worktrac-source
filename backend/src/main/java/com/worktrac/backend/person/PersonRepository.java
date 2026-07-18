package com.worktrac.backend.person;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

import java.util.List;
import java.util.Optional;

public interface PersonRepository extends JpaRepository<Person, Long> {

    List<Person> findByAccount_IdOrderByCreatedAtAsc(Long accountId);

    Optional<Person> findByIdAndAccount_Id(Long id, Long accountId);

    void deleteByAccount_Id(Long accountId);

    // Admin-only: [accountId, count] pairs across ALL accounts, for the admin portal's
    // per-household member counts. Object[] (not a projection type) since this is
    // purely internal, one-off aggregate consumed only by AdminService.
    @Query("SELECT p.account.id, COUNT(p) FROM Person p GROUP BY p.account.id")
    List<Object[]> countGroupedByAccount();

    // Admin-only: [accountId, name] for each account's primary person (there is always
    // exactly one), for the admin portal's Accounts grid "account holder" column.
    @Query("SELECT p.account.id, p.name FROM Person p WHERE p.primary = true")
    List<Object[]> primaryNameGroupedByAccount();

    // Admin-only: every person across every account, account eagerly fetched to avoid
    // an N+1 when the admin portal renders each person's household name.
    @Query("SELECT p FROM Person p JOIN FETCH p.account ORDER BY p.createdAt DESC")
    List<Person> findAllWithAccount();
}
