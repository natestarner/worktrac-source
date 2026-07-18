package com.worktrac.backend.workoutsession;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.Instant;
import java.util.List;
import java.util.Optional;

public interface WorkoutSessionRepository extends JpaRepository<WorkoutSession, Long> {

    Optional<WorkoutSession> findFirstByPerson_IdAndEndedAtIsNull(Long personId);

    List<WorkoutSession> findByPerson_IdOrderByStartedAtDesc(Long personId);

    Optional<WorkoutSession> findByIdAndPerson_Id(Long id, Long personId);

    // Defense-in-depth: lets a controller confirm a session belongs to the caller's
    // account without trusting a client-supplied personId at all.
    Optional<WorkoutSession> findByIdAndPerson_Account_Id(Long id, Long accountId);

    // Admin-only aggregates below, consumed only by AdminService.

    @Query("SELECT ws.person.account.id, COUNT(ws) FROM WorkoutSession ws GROUP BY ws.person.account.id")
    List<Object[]> countGroupedByAccount();

    @Query("SELECT ws.person.account.id, MAX(ws.startedAt) FROM WorkoutSession ws GROUP BY ws.person.account.id")
    List<Object[]> lastActivityGroupedByAccount();

    @Query("SELECT COUNT(DISTINCT ws.person.account.id) FROM WorkoutSession ws WHERE ws.startedAt >= :cutoff")
    long countDistinctActiveAccountsSince(@Param("cutoff") Instant cutoff);
}
