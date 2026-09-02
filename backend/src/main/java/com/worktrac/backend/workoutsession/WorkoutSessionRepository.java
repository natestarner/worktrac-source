package com.worktrac.backend.workoutsession;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.Modifying;

public interface WorkoutSessionRepository extends JpaRepository<WorkoutSession, Long> {

    Optional<WorkoutSession> findFirstByPerson_IdAndEndedAtIsNull(Long personId);

    List<WorkoutSession> findByPerson_IdOrderByStartedAtDesc(Long personId);

    Optional<WorkoutSession> findByIdAndPerson_Id(Long id, Long personId);

    // Defense-in-depth: lets a controller confirm a session belongs to the caller's
    // account without trusting a client-supplied personId at all.
    Optional<WorkoutSession> findByIdAndPerson_Account_Id(Long id, Long accountId);

    // How much of this person's history the Free-tier window is hiding, as ONE aggregate rather
    // than a full-history load: COUNT plus the oldest startedAt, in a single round trip. StatsService
    // already loads every set a person has ever logged on four separate paths, and
    // .claude/rules/trends.md forbids adding a fifth -- a projection/aggregate is the sanctioned way
    // to add a number.
    //
    // The EXISTS sub-select is not an optimization: WorkoutSessionService#getHistory drops sessions
    // with no sets (an abandoned retroactive session), so counting them here would promise the
    // person more hidden workouts than upgrading could ever show them.
    //
    // Returns a single row; COUNT is 0 and MIN is null when nothing is hidden.
    @Query("SELECT new com.worktrac.backend.workoutsession.HiddenHistorySummary("
            + "COUNT(s), MIN(s.startedAt)) FROM WorkoutSession s "
            + "WHERE s.person.id = :personId AND s.startedAt < :floor "
            + "AND EXISTS (SELECT 1 FROM WorkoutSet w WHERE w.session = s)")
    HiddenHistorySummary summarizeHiddenBefore(@Param("personId") Long personId, @Param("floor") Instant floor);

    // Admin-only aggregates below, consumed only by AdminService.

    @Query("SELECT ws.person.account.id, COUNT(ws) FROM WorkoutSession ws GROUP BY ws.person.account.id")
    List<Object[]> countGroupedByAccount();

    @Query("SELECT ws.person.account.id, MAX(ws.startedAt) FROM WorkoutSession ws GROUP BY ws.person.account.id")
    List<Object[]> lastActivityGroupedByAccount();

    @Query("SELECT COUNT(DISTINCT ws.person.account.id) FROM WorkoutSession ws WHERE ws.startedAt >= :cutoff")
    long countDistinctActiveAccountsSince(@Param("cutoff") Instant cutoff);

    // Only sessions this import CREATED (an appended-to one is never stamped) and only once they
    // are empty -- a set logged by hand into an imported workout keeps that workout alive. Scoped
    // by owner as well as batch, for the reason in ImportUndoService.
    @Modifying
    @Query("DELETE FROM WorkoutSession s WHERE s.importBatchId = :batchId AND s.person.id = :personId "
            + "AND NOT EXISTS (SELECT 1 FROM WorkoutSet w WHERE w.session = s)")
    int deleteEmptyByImportBatchIdForPerson(@Param("batchId") Long batchId, @Param("personId") Long personId);

}
