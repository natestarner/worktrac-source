package com.worktrac.backend.workoutset;

import com.worktrac.backend.account.Account;
import com.worktrac.backend.account.AccountRepository;
import com.worktrac.backend.common.NotFoundException;
import com.worktrac.backend.exercise.Exercise;
import com.worktrac.backend.exercise.ExerciseRepository;
import com.worktrac.backend.person.Person;
import com.worktrac.backend.person.PersonService;
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
    public LogSetResultDto logLiveSet(Long accountId, Long personId, LogSetRequest request) {
        Person person = personService.requireOwnedPerson(personId, accountId);
        Account account = accountRepository.getReferenceById(accountId);
        Exercise exercise = requireVisibleExercise(accountId, request.exerciseId());

        WorkoutSession session = workoutSessionService.getOrCreateLiveSession(person);
        Integer restSeconds = computeRestSeconds(session, exercise);
        return insertSetAndDetectPr(person, session, exercise, request.weight(), request.reps(), account.getDefaultUnit(), restSeconds);
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
    public LogSetResultDto logSetIntoSession(Long accountId, Long sessionId, LogSetRequest request) {
        WorkoutSession session = workoutSessionRepository.findByIdAndPerson_Account_Id(sessionId, accountId)
                .orElseThrow(() -> new NotFoundException("No such session"));
        Person person = session.getPerson();
        Account account = accountRepository.getReferenceById(accountId);
        Exercise exercise = requireVisibleExercise(accountId, request.exerciseId());

        return insertSetAndDetectPr(person, session, exercise, request.weight(), request.reps(), account.getDefaultUnit(), null);
    }

    // Null if this is the first set of this exercise logged in the session (nothing to
    // diff against), otherwise the gap between now and the most recent prior set of the
    // same exercise in the same session -- deliberately scoped to the same exercise, not
    // just the same session, so supersetting into a different exercise between sets
    // doesn't corrupt the number. Uses the injected Clock (not Instant.now()) so this is
    // deterministically testable with a MutableClock, same as WorkoutSessionService's
    // staleness rule -- see RestSecondsTest.
    private Integer computeRestSeconds(WorkoutSession session, Exercise exercise) {
        return workoutSetRepository.findFirstBySession_IdAndExercise_IdOrderByCreatedAtDesc(session.getId(), exercise.getId())
                .map(previous -> (int) Duration.between(previous.getCreatedAt(), clock.instant()).getSeconds())
                .orElse(null);
    }

    private LogSetResultDto insertSetAndDetectPr(Person person, WorkoutSession session, Exercise exercise,
                                                  BigDecimal weight, int reps, String unit, Integer restSeconds) {
        Optional<BigDecimal> prevBestComparableLb = statsService.getBestComparableLb(person.getId(), exercise.getId());

        WorkoutSet set = workoutSetRepository.save(new WorkoutSet(session, person, exercise, weight, reps, unit, restSeconds));

        BigDecimal newComparableLb = statsService.comparableLb(weight, reps, unit);
        boolean isPR = prevBestComparableLb.isEmpty() || newComparableLb.compareTo(prevBestComparableLb.get()) > 0;
        var best = statsService.getBest(person.getId(), exercise.getId()).orElseThrow();

        return new LogSetResultDto(WorkoutSetDto.from(set), WorkoutSessionDto.from(session), isPR, best);
    }

    // Sets already logged into a specific session for a specific exercise, in the order
    // logged -- backs the Log tab's "Set 1 / Set 2..." list so each row can be tapped
    // to edit or removed individually (the history/summary views only carry aggregate
    // weight/reps, not set ids).
    @Transactional(readOnly = true)
    public java.util.List<WorkoutSetDto> listForSessionAndExercise(Long accountId, Long sessionId, Long exerciseId) {
        workoutSessionRepository.findByIdAndPerson_Account_Id(sessionId, accountId)
                .orElseThrow(() -> new NotFoundException("No such session"));
        return workoutSetRepository.findBySession_IdAndExercise_IdOrderByCreatedAtAsc(sessionId, exerciseId).stream()
                .map(WorkoutSetDto::from)
                .toList();
    }

    @Transactional
    public WorkoutSetDto editSet(Long accountId, Long setId, EditSetRequest request) {
        WorkoutSet set = workoutSetRepository.findByIdAndSession_Person_Account_Id(setId, accountId)
                .orElseThrow(() -> new NotFoundException("No such set"));
        set.setWeight(request.weight());
        set.setReps(request.reps());
        return WorkoutSetDto.from(set);
    }

    @Transactional
    public void deleteSet(Long accountId, Long setId) {
        WorkoutSet set = workoutSetRepository.findByIdAndSession_Person_Account_Id(setId, accountId)
                .orElseThrow(() -> new NotFoundException("No such set"));
        workoutSetRepository.delete(set);
    }

    private Exercise requireVisibleExercise(Long accountId, Long exerciseId) {
        Exercise exercise = exerciseRepository.findById(exerciseId)
                .orElseThrow(() -> new NotFoundException("No such exercise"));
        boolean visible = exercise.isGlobal() || exercise.getAccount().getId().equals(accountId);
        if (!visible) {
            throw new NotFoundException("No such exercise");
        }
        return exercise;
    }
}
