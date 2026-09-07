package com.worktrac.backend.workoutset;

import com.worktrac.backend.account.Account;
import com.worktrac.backend.account.AccountRepository;
import com.worktrac.backend.common.NotFoundException;
import com.worktrac.backend.exercise.Exercise;
import com.worktrac.backend.exercise.ExerciseRepository;
import com.worktrac.backend.membership.AccountAccess;
import com.worktrac.backend.membership.Permission;
import com.worktrac.backend.person.Person;
import com.worktrac.backend.person.PersonService;
import com.worktrac.backend.stats.BestDto;
import com.worktrac.backend.stats.StatsService;
import com.worktrac.backend.workoutsession.WorkoutSession;
import com.worktrac.backend.workoutsession.WorkoutSessionDto;
import com.worktrac.backend.workoutsession.WorkoutSessionRepository;
import com.worktrac.backend.workoutsession.WorkoutSessionService;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Optional;

@Service
public class WorkoutSetService {

    private final WorkoutSetRepository workoutSetRepository;
    private final WorkoutSessionRepository workoutSessionRepository;
    private final WorkoutSessionService workoutSessionService;
    private final ExerciseRepository exerciseRepository;
    private final AccountRepository accountRepository;
    private final PersonService personService;
    private final StatsService statsService;
    private final Clock clock;

    public WorkoutSetService(WorkoutSetRepository workoutSetRepository, WorkoutSessionRepository workoutSessionRepository,
                              WorkoutSessionService workoutSessionService, ExerciseRepository exerciseRepository,
                              AccountRepository accountRepository, PersonService personService, StatsService statsService,
                              Clock clock) {
        this.workoutSetRepository = workoutSetRepository;
        this.workoutSessionRepository = workoutSessionRepository;
        this.workoutSessionService = workoutSessionService;
        this.exerciseRepository = exerciseRepository;
        this.accountRepository = accountRepository;
        this.personService = personService;
        this.statsService = statsService;
        this.clock = clock;
    }

    // Logs into the person's auto-managed live session: reuses it, auto-closes and
    // rolls over a stale one, or starts a brand new session -- then bumps
    // last_activity_at. This is the path a live (not retroactive) set always takes, and
    // the ONLY path that computes rest_seconds -- see computeRestSeconds below and the
    // V17 migration for why this must never be done from logSetIntoSession too.
    @Transactional
    public LogSetResultDto logLiveSet(AccountAccess access, Long personId, LogSetRequest request) {
        Person person = personService.requireWritablePerson(personId, access);
        LogSetResultDto duplicate = findDuplicate(access, request.idempotencyKey());
        if (duplicate != null) {
            return duplicate;
        }
        Account account = accountRepository.getReferenceById(access.accountId());
        Exercise exercise = requireVisibleExercise(access.accountId(), request.exerciseId());

        // The set's real logging time: the client's timestamp when supplied (so a delayed/offline
        // sync stays accurate), otherwise now. Computed BEFORE getOrCreateLiveSession so a session
        // auto-created right here (the first set of a brand-new workout) is stamped with when the
        // workout actually started, not whenever this replay happened to reach the server.
        Instant loggedAt = request.clientLoggedAt() != null ? request.clientLoggedAt() : clock.instant();
        WorkoutSession session = workoutSessionService.getOrCreateLiveSession(person, loggedAt);
        // rest_seconds is the gap from the prior set to THIS time, so it stays honest either way
        // (no separate "null on replay" special-case needed).
        Integer restSeconds = computeRestSeconds(session, exercise, loggedAt);
        Measure measure = resolveMeasure(exercise, request.reps(), request.durationSeconds());
        return insertSetAndDetectPr(person, session, exercise, request.weight(), measure,
                account.getDefaultUnit(), restSeconds, loggedAt, request.idempotencyKey());
    }

    // Logs directly into an explicit session (retroactive session, or "editing a past
    // session") -- no auto-start/autoclose/last-activity bookkeeping, matching the
    // design's "editing a past session doesn't touch the live-session machinery" rule.
    // No personId in this endpoint's path -- ownership is enforced via
    // session -> person -> account. rest_seconds is always null here: a set reached
    // through this endpoint is by definition not part of continuous real-time logging
    // (a manual/backfilled session, or an old session being resumed to add a forgotten
    // set), so any created_at gap against a prior set would be meaningless, not just
    // imprecise. See CLAUDE.md's Data Model Notes for the full rationale.
    @Transactional
    public LogSetResultDto logSetIntoSession(AccountAccess access, Long sessionId, LogSetRequest request) {
        LogSetResultDto duplicate = findDuplicate(access, request.idempotencyKey());
        if (duplicate != null) {
            return duplicate;
        }
        WorkoutSession session = workoutSessionRepository.findByIdAndPerson_Account_Id(sessionId, access.accountId())
                .orElseThrow(() -> new NotFoundException("We couldn't find that workout."));
        // Child-id endpoint: the finder proves the session is in this ACCOUNT, not that the caller
        // may write to the PERSON behind it. See WorkoutSessionService.editSession.
        Person person = personService.requireWritablePerson(session.getPerson(), access,
                "We couldn't find that workout.");
        Account account = accountRepository.getReferenceById(access.accountId());
        Exercise exercise = requireVisibleExercise(access.accountId(), request.exerciseId());

        // rest_seconds stays null here (this endpoint is never real-time logging -- see the method
        // doc above), but created_at still honors the client timestamp when supplied.
        Instant loggedAt = request.clientLoggedAt() != null ? request.clientLoggedAt() : clock.instant();
        Measure measure = resolveMeasure(exercise, request.reps(), request.durationSeconds());
        return insertSetAndDetectPr(person, session, exercise, request.weight(), measure,
                account.getDefaultUnit(), null, loggedAt, request.idempotencyKey());
    }

    // What this set actually measures, reconciled against what its exercise is tracked in.
    //
    // ⚠️ This must reject as little as possible. shouldRetryWrite treats any 4xx outside {408,429}
    // as terminal, so every rejection here PERMANENTLY DISCARDS a set that may have been sitting in
    // the durable outbox through an entire outage. Only genuinely impossible payloads are refused;
    // one recoverable shape is accepted instead:
    //
    //   Legacy shape -- a duration exercise receiving reps and no durationSeconds. This is what a
    //   client sends when its cached exercise catalog predates V50's conversion of "Plank (sec)"
    //   into a duration exercise, and an offline client holds that cache for its whole outage.
    //   Those numbers already WERE seconds (that is what the "(sec)" in the name meant), so
    //   storing reps as the duration is exact rather than a fudge. Delete this branch once no
    //   client can still hold a pre-V50 catalog.
    private Measure resolveMeasure(Exercise exercise, int reps, Integer durationSeconds) {
        if (!exercise.isDurationTracked()) {
            if (durationSeconds != null) {
                throw new IllegalArgumentException(
                        "%s is tracked in reps, but this set carries a duration".formatted(exercise.getName()));
            }
            return new Measure(reps, null);
        }
        if (durationSeconds != null) {
            if (reps != 0) {
                throw new IllegalArgumentException(
                        "%s is tracked in seconds; a set cannot carry reps as well".formatted(exercise.getName()));
            }
            return new Measure(0, durationSeconds);
        }
        if (reps > 0) {
            return new Measure(0, reps);
        }
        throw new IllegalArgumentException(
                "%s is tracked in seconds, so this set needs a duration".formatted(exercise.getName()));
    }

    // reps is always 0 when durationSeconds is present -- see WorkoutSet and V48.
    private record Measure(int reps, Integer durationSeconds) {
    }

    // If this write's idempotency key already produced a set (a retried or offline-replayed
    // request whose original actually committed), return that set instead of inserting a duplicate.
    // isPR is reported false on the dedup path: the set already exists, so a replay is never itself
    // a new PR. Null/blank key -> no dedup (nothing to key on).
    private LogSetResultDto findDuplicate(AccountAccess access, String idempotencyKey) {
        if (idempotencyKey == null || idempotencyKey.isBlank()) {
            return null;
        }
        return workoutSetRepository.findByClientKeyAndSession_Person_Account_Id(idempotencyKey, access.accountId())
                // ⚠️ The lookup is ACCOUNT-scoped, and it has to stay that way:
                // UX_workout_sets_client_key (V41) is unique across the whole table, so narrowing
                // the dedup below the scope of the index would let a "not a duplicate" answer walk
                // straight into a unique-constraint violation.
                //
                // What that scope means with more than one login is that a key belonging to
                // ANOTHER person in the household would otherwise be answered with that person's
                // set, its session and its best -- a read of someone else's data through an
                // endpoint that looks like a write. Treat it as no duplicate instead.
                //
                // Residual, and deliberately accepted: the insert that follows will then hit the
                // unique index and fail as a 500, which the outbox retries. That is only reachable
                // by forging another person's key -- a client-generated UUID that appears in no
                // response this caller can see -- so it is not a collision anyone reaches by
                // accident. Failing the forger's own write is a better outcome than serving them
                // the row, and better than a terminal 4xx, which would discard a real write.
                .filter(existing -> access.has(Permission.WRITE_OTHER_PEOPLE)
                        || access.isSelf(existing.getPerson().getId()))
                .map(existing -> {
                    BestDto best = statsService.getBest(existing.getPerson().getId(), existing.getExercise().getId())
                            .orElse(null);
                    return new LogSetResultDto(WorkoutSetDto.from(existing), WorkoutSessionDto.from(existing.getSession()),
                            false, best);
                })
                .orElse(null);
    }

    // Null if this is the first set of this exercise logged in the session (nothing to
    // diff against), otherwise the gap between now and the most recent prior set of the
    // same exercise in the same session -- deliberately scoped to the same exercise, not
    // just the same session, so supersetting into a different exercise between sets
    // doesn't corrupt the number. Uses the injected Clock (not Instant.now()) so this is
    // deterministically testable with a MutableClock, same as WorkoutSessionService's
    // staleness rule -- see RestSecondsTest.
    private Integer computeRestSeconds(WorkoutSession session, Exercise exercise, Instant loggedAt) {
        return workoutSetRepository.findFirstBySession_IdAndExercise_IdOrderByCreatedAtDesc(session.getId(), exercise.getId())
                .map(previous -> (int) Duration.between(previous.getCreatedAt(), loggedAt).getSeconds())
                .orElse(null);
    }

    private LogSetResultDto insertSetAndDetectPr(Person person, WorkoutSession session, Exercise exercise,
                                                  BigDecimal weight, Measure measure, String unit, Integer restSeconds,
                                                  Instant createdAt, String clientKey) {
        Optional<BigDecimal> prevBestComparable = statsService.getBestComparableValue(person.getId(), exercise.getId());

        WorkoutSet set = workoutSetRepository.save(
                new WorkoutSet(session, person, exercise, weight, measure.reps(), measure.durationSeconds(), unit,
                        restSeconds, createdAt, clientKey));

        BigDecimal newComparable = statsService.comparableValue(weight, measure.reps(), measure.durationSeconds(), unit);
        boolean isPR = prevBestComparable.isEmpty() || newComparable.compareTo(prevBestComparable.get()) > 0;
        var best = statsService.getBest(person.getId(), exercise.getId()).orElseThrow();

        return new LogSetResultDto(WorkoutSetDto.from(set), WorkoutSessionDto.from(session), isPR, best);
    }

    // Sets already logged into a specific session for a specific exercise, in the order
    // logged -- backs the Log tab's "Set 1 / Set 2..." list so each row can be tapped
    // to edit or removed individually (the history/summary views only carry aggregate
    // weight/reps, not set ids).
    @Transactional(readOnly = true)
    public java.util.List<WorkoutSetDto> listForSessionAndExercise(AccountAccess access, Long sessionId, Long exerciseId) {
        WorkoutSession session = workoutSessionRepository.findByIdAndPerson_Account_Id(sessionId, access.accountId())
                .orElseThrow(() -> new NotFoundException("We couldn't find that workout."));
        // Read, so visible rather than writable -- a member may look at a workout they can see.
        personService.requireVisiblePerson(session.getPerson(), access, "We couldn't find that workout.");
        return workoutSetRepository.findBySession_IdAndExercise_IdOrderByCreatedAtAsc(sessionId, exerciseId).stream()
                .map(WorkoutSetDto::from)
                .toList();
    }

    @Transactional
    public WorkoutSetDto editSet(AccountAccess access, Long setId, EditSetRequest request) {
        WorkoutSet set = workoutSetRepository.findByIdAndSession_Person_Account_Id(setId, access.accountId())
                .orElseThrow(() -> new NotFoundException("We couldn't find that set."));
        // Child-id endpoint: the finder proves the set is in this ACCOUNT, not that the caller may
        // write to the PERSON behind it. See WorkoutSessionService.editSession.
        personService.requireWritablePerson(set.getPerson(), access, "We couldn't find that set.");
        // Same reconciliation (and the same leniency) as a create -- an edit is a separate durable
        // write that can sit in the outbox just as long, so a rejection here loses it just as
        // permanently. restSeconds is deliberately untouched: it records what actually happened.
        Measure measure = resolveMeasure(set.getExercise(), request.reps(), request.durationSeconds());
        set.setWeight(request.weight());
        set.setReps(measure.reps());
        set.setDurationSeconds(measure.durationSeconds());
        return WorkoutSetDto.from(set);
    }

    @Transactional
    public void deleteSet(AccountAccess access, Long setId) {
        WorkoutSet set = workoutSetRepository.findByIdAndSession_Person_Account_Id(setId, access.accountId())
                .orElseThrow(() -> new NotFoundException("We couldn't find that set."));
        personService.requireWritablePerson(set.getPerson(), access, "We couldn't find that set.");
        workoutSetRepository.delete(set);
    }

    private Exercise requireVisibleExercise(Long accountId, Long exerciseId) {
        Exercise exercise = exerciseRepository.findById(exerciseId)
                .orElseThrow(() -> new NotFoundException("We couldn't find that exercise."));
        boolean visible = exercise.isGlobal() || exercise.getAccount().getId().equals(accountId);
        if (!visible) {
            throw new NotFoundException("We couldn't find that exercise.");
        }
        return exercise;
    }
}
