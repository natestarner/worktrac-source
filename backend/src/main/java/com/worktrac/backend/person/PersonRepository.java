package com.worktrac.backend.person;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.Optional;

public interface PersonRepository extends JpaRepository<Person, Long> {

    List<Person> findByAccount_IdOrderByCreatedAtAsc(Long accountId);

    Optional<Person> findByIdAndAccount_Id(Long id, Long accountId);

    void deleteByAccount_Id(Long accountId);

    // Genuine single-statement bulk delete for TestDataCleanupService -- unlike
    // deleteByAccount_Id above (a derived delete method, which Spring Data JPA implements by
    // loading every matching entity and removing it one at a time so entity lifecycle callbacks
    // fire correctly), this issues one DELETE ... WHERE account_id IN (...) across every
    // matching e2e test account at once. Safe here specifically because AccountDeletionService's
    // own comment already establishes the DB's FK cascades (routines, workout_sessions,
    // workout_sets, person_exercise, ...) fire on a person row being deleted regardless of
    // whether that delete came from JPA's entity-by-entity path or a bulk JPQL statement -- the
    // cascade lives in the schema, not in Hibernate's lifecycle callbacks.
    @Modifying
    @Query("DELETE FROM Person p WHERE p.account.id IN :accountIds")
    void deleteByAccountIdIn(@Param("accountIds") List<Long> accountIds);

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
