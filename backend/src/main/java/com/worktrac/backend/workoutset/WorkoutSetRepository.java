package com.worktrac.backend.workoutset;

import jakarta.persistence.QueryHint;
import org.hibernate.jpa.HibernateHints;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.jpa.repository.QueryHints;
import org.springframework.data.repository.query.Param;

import java.util.Collection;
import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.Modifying;

public interface WorkoutSetRepository extends JpaRepository<WorkoutSet, Long> {

    // Quota enforcement (QuotaService), used ONLY by the importer -- see requireSetCapacity for why
    // logging a set deliberately does not consult this. A count over a whole account is not
    // something to put on a per-set write path.
    @Query("SELECT COUNT(ws) FROM WorkoutSet ws WHERE ws.session.person.account.id = :accountId")
    long countByAccountId(@Param("accountId") Long accountId);


    // Whole-history reads. Each loads the set's session in the SAME query (JOIN FETCH), because
    // every caller reads session.startedAt for every row -- chronology, the Free-tier window, the
    // weekly buckets. Loaded lazily, that was one SELECT per session: ~2,000 statements for one
    // /prs or trends request at 2,000 sessions. The join is on a NOT NULL foreign key, so it adds a
    // column set to each row and never changes which rows come back or their order.
    // Guarded by HistoryScaleTest. Don't drop the fetch to "simplify" these into plain derived
    // queries; don't reach for a global hibernate.default_batch_fetch_size instead either -- that
    // changes every lazy load in the app, not just these.
    //
    // CHRONOLOGICAL, and totally ordered: workout start, workout id, then each set as it was logged
    // -- History's own order. A record tie is decided by that order once weight has had its say
    // (StatsService#bestSet), so an unordered load let the index hand whichever set it liked the
    // record; and the device derives the same records from History (statsFromHistory.js), which
    // only agrees if both sides walk the sets the same way.
    //
    // `s.person.id = :personId` is not redundant, and must stay. A set's workout is always the same
    // person's (History reads sets by person AND workout on exactly that assumption), but the
    // database cannot know it -- and without it being SAID, SQL Server has no way to reach this
    // person's workouts except by scanning workout_sessions whole: a cost that follows the table,
    // not the person. Said, it seeks this person's workouts on an index V84 made cover the session.
    // StatsCostTest fails without it.
    //
    // The per-exercise load is also HASH-joined, and that hint is load-bearing too. It runs twice
    // inside every set's save (the PR check, WorkoutSetService#insertSetAndDetectPr) and again for
    // the Log screen's summary. Two plans answer it: seek this exercise's sets and
    // hash them against this person's workouts (~45 page reads at five years), or walk every one of
    // the person's workouts seeking sets in each (~one per workout -- thousands). They cost the same
    // for a one-workout household, and whichever household compiles the statement first leaves its
    // plan cached for everybody: after lower's e2e run, that is always a one-workout household.
    // StatsCostTest reproduces exactly that and fails without the hint.
    @QueryHints(@QueryHint(name = HibernateHints.HINT_QUERY_DATABASE, value = "HASH JOIN"))
    @Query("SELECT ws FROM WorkoutSet ws JOIN FETCH ws.session s "
            + "WHERE ws.person.id = :personId AND ws.exercise.id = :exerciseId AND s.person.id = :personId "
            + "ORDER BY s.startedAt, s.id, ws.createdAt, ws.id")
    List<WorkoutSet> loadExerciseChronologically(@Param("personId") Long personId, @Param("exerciseId") Long exerciseId);

    // The whole person, in the same chronological order and by the same route -- for the PRs board.
    // (Export keeps insertion order: findByPerson_IdOrderByCreatedAtAscIdAsc below.)
    @Query("SELECT ws FROM WorkoutSet ws JOIN FETCH ws.session s "
            + "WHERE ws.person.id = :personId AND s.person.id = :personId "
            + "ORDER BY s.startedAt, s.id, ws.createdAt, ws.id")
    List<WorkoutSet> loadPersonChronologically(@Param("personId") Long personId);

    // The "has a logged set" half of a person's Log picker: every exercise they've ever
    // logged shows up automatically, alongside their favorites.
    @Query("SELECT DISTINCT ws.exercise.id FROM WorkoutSet ws WHERE ws.person.id = :personId")
    List<Long> findDistinctExerciseIdsByPerson(@Param("personId") Long personId);

    List<WorkoutSet> findBySession_Id(Long sessionId);

    List<WorkoutSet> findBySession_IdAndExercise_IdOrderByCreatedAtAsc(Long sessionId, Long exerciseId);

    // Used to compute rest_seconds for a newly-logged live set: the gap between "now"
    // and this row's created_at. Only ever called from the live-session path -- see
    // WorkoutSetService.logLiveSet.
    Optional<WorkoutSet> findFirstBySession_IdAndExercise_IdOrderByCreatedAtDesc(Long sessionId, Long exerciseId);

    // Ordered by id as well as created_at, so the order is TOTAL rather than merely mostly-sorted.
    // Two sets can share a created_at -- the column is a datetime2, but a CSV round trip only
    // carries seconds, so an imported pair genuinely lands on the same instant -- and without a
    // tiebreaker SQL Server is free to return those two in either order. That made an export
    // non-deterministic for exactly the data an import produces.
    //
    // Loads each set's session in the same query, by the same route as the loads above (the session's
    // person said, so its workouts are sought, never scanned). Keeps its derived-looking name because
    // export and several tests call it; the query is explicit for the predicate.
    @Query("SELECT ws FROM WorkoutSet ws JOIN FETCH ws.session s "
            + "WHERE ws.person.id = :personId AND s.person.id = :personId "
            + "ORDER BY ws.createdAt, ws.id")
    List<WorkoutSet> findByPerson_IdOrderByCreatedAtAscIdAsc(@Param("personId") Long personId);

    Optional<WorkoutSet> findByIdAndPerson_Id(Long id, Long personId);

    // Defense-in-depth: confirms a set belongs to the caller's account by walking
    // set -> session -> person -> account, without trusting a client-supplied personId.
    Optional<WorkoutSet> findByIdAndSession_Person_Account_Id(Long id, Long accountId);

    // Idempotency: an already-committed set for this client key. Account-scoped so a key can only
    // ever match the caller's own set.
    Optional<WorkoutSet> findByClientKeyAndSession_Person_Account_Id(String clientKey, Long accountId);

    boolean existsByExercise_Id(Long exerciseId);

    // "Has anyone OTHER than this person logged against this exercise?" -- the question that
    // decides whether a rename would relabel somebody else's history.
    //
    // Derived rather than a @Query so the person comparison stays visible in the name. `Not` on a
    // nested path is exactly `person_id <> ?`, and person_id is NOT NULL, so there is no
    // three-valued-logic surprise here.
    boolean existsByExercise_IdAndPerson_IdNot(Long exerciseId, Long personId);

    /**
     * The same question as {@link #existsByExercise_IdAndPerson_IdNot}, asked about MANY exercises
     * at once: which of these has somebody OTHER than this person logged against?
     *
     * <p>⚠️ ONE QUERY PER LIST CALL, NEVER PER ROW. The single-row form above is right on the
     * rename write path, where there is exactly one exercise to ask about. Calling it while mapping
     * a list is an N+1 across the whole catalog, which is why this exists.
     *
     * <p>Callers pass only the household's OWN exercise ids — a global (preloaded) exercise is
     * never renamable by anyone, so including the ~200 of them would grow the IN clause for
     * answers nothing reads. Callers must also short-circuit on an empty collection rather than
     * issuing an empty IN.
     *
     * <p>{@code person_id} is NOT NULL, so {@code <>} has no three-valued-logic surprise here —
     * same note as the single-row form.
     */
    @Query("SELECT DISTINCT ws.exercise.id FROM WorkoutSet ws "
            + "WHERE ws.exercise.id IN :exerciseIds AND ws.person.id <> :personId")
    List<Long> findIdsUsedByAnotherPerson(@Param("exerciseIds") Collection<Long> exerciseIds,
                                          @Param("personId") Long personId);

    // Admin-only: [accountId, count] pairs across ALL accounts, consumed only by AdminService.
    @Query("SELECT ws.session.person.account.id, COUNT(ws) FROM WorkoutSet ws GROUP BY ws.session.person.account.id")
    List<Object[]> countGroupedByAccount();

    // Undo, scoped by BOTH the batch and its owner. The person predicate is not redundant defence
    // in depth for its own sake: "every set stamped with this batch belongs to this person" is an
    // app-layer invariant the schema does not enforce, and this is a delete. See ImportUndoService.
    @Modifying
    @Query("DELETE FROM WorkoutSet s WHERE s.importBatchId = :batchId AND s.person.id = :personId")
    int deleteByImportBatchIdForPerson(@Param("batchId") Long batchId, @Param("personId") Long personId);

}
