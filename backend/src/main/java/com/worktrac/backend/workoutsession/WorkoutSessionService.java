package com.worktrac.backend.workoutsession;

import com.worktrac.backend.common.NotFoundException;
import com.worktrac.backend.person.Person;
import com.worktrac.backend.person.PersonService;
import com.worktrac.backend.stats.SetSummaryDto;
import com.worktrac.backend.workoutset.WorkoutSet;
import com.worktrac.backend.workoutset.WorkoutSetRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

@Service
public class WorkoutSessionService {

    // A session is treated as over if its last logged set was more than 8 hours ago --
    // measured from last_activity_at, not started_at, so a long-running live session
    // doesn't get incorrectly auto-closed mid-workout.
    static final Duration AUTOCLOSE = Duration.ofHours(8);

    private final WorkoutSessionRepository workoutSessionRepository;
    private final WorkoutSetRepository workoutSetRepository;
    private final PersonService personService;
    private final Clock clock;

    public WorkoutSessionService(WorkoutSessionRepository workoutSessionRepository, WorkoutSetRepository workoutSetRepository,
                                  PersonService personService, Clock clock) {
        this.workoutSessionRepository = workoutSessionRepository;
        this.workoutSetRepository = workoutSetRepository;
        this.personService = personService;
        this.clock = clock;
    }

    // Looks up the live session for a person, transparently closing it first if stale.
    // Used both by the read-only "GET .../sessions/live" endpoint and internally by
    // WorkoutSetService when resolving where a live-logged set should land.
    @Transactional
    public Optional<WorkoutSession> getLiveSession(Person person) {
        Optional<WorkoutSession> active = workoutSessionRepository.findFirstByPerson_IdAndEndedAtIsNull(person.getId());
        if (active.isEmpty()) {
            return Optional.empty();
        }
        WorkoutSession session = active.get();
        if (Duration.between(session.getLastActivityAt(), Instant.now(clock)).compareTo(AUTOCLOSE) > 0) {
            session.setEndedAt(session.getLastActivityAt());
            return Optional.empty();
        }
        return Optional.of(session);
    }

    // Resolves the session a live-logged set should attach to: reuses the active
    // session (bumping last_activity_at), auto-closes and replaces a stale one, or
    // starts a brand new session if none exists.
    @Transactional
    public WorkoutSession getOrCreateLiveSession(Person person) {
        Optional<WorkoutSession> live = getLiveSession(person);
        Instant now = Instant.now(clock);
        if (live.isPresent()) {
            WorkoutSession session = live.get();
            session.setLastActivityAt(now);
            return session;
        }
        return workoutSessionRepository.save(new WorkoutSession(person, now, false));
    }

    @Transactional(readOnly = true)
    public Optional<WorkoutSessionDto> getLiveSessionDto(Long accountId, Long personId) {
        Person person = personService.requireOwnedPerson(personId, accountId);
        return getLiveSession(person).map(WorkoutSessionDto::from);
    }

    @Transactional
    public void endWorkout(Long accountId, Long personId) {
        Person person = personService.requireOwnedPerson(personId, accountId);
        getLiveSession(person).ifPresent(session -> session.setEndedAt(Instant.now(clock)));
    }

    @Transactional
    public WorkoutSessionDto createPastSession(Long accountId, Long personId, Instant startedAt) {
        Person person = personService.requireOwnedPerson(personId, accountId);
        WorkoutSession session = new WorkoutSession(person, startedAt, true);
        session.setEndedAt(startedAt); // point-in-time marker until sets are logged into it
        return WorkoutSessionDto.from(workoutSessionRepository.save(session));
    }

    // No personId in this endpoint's path -- ownership is enforced purely via
    // session -> person -> account, since there is no client-supplied personId to
    // cross-check against at all here.
    @Transactional
    public WorkoutSessionDto editSession(Long accountId, Long sessionId, Instant newStartedAt) {
        WorkoutSession session = workoutSessionRepository.findByIdAndPerson_Account_Id(sessionId, accountId)
                .orElseThrow(() -> new NotFoundException("No such session"));

        Duration delta = Duration.between(session.getStartedAt(), newStartedAt);
        // Shift every timestamp on the session by the same delta -- preserves the
        // recorded duration (endedAt - startedAt) and the staleness window, rather than
        // collapsing endedAt to the new startedAt and silently erasing how long the
        // workout actually took.
        if (session.getEndedAt() != null) {
            session.setEndedAt(session.getEndedAt().plus(delta));
        }
        session.setLastActivityAt(session.getLastActivityAt().plus(delta));
        session.setStartedAt(newStartedAt);
        return WorkoutSessionDto.from(session);
    }

    // All of a person's sessions, most recent first, each showing the exercises/sets
    // done in it (grouped in first-seen order within the session, not necessarily
    // chronological). Sessions with zero sets logged (e.g. an abandoned retroactive
    // session) are excluded, matching the design's History tab.
    @Transactional(readOnly = true)
    public List<HistorySessionDto> getHistory(Long accountId, Long personId) {
        Person person = personService.requireOwnedPerson(personId, accountId);
        List<WorkoutSet> allSets = workoutSetRepository.findByPerson_IdOrderByCreatedAtAsc(person.getId());

        Map<Long, List<WorkoutSet>> setsBySession = new LinkedHashMap<>();
        for (WorkoutSet s : allSets) {
            setsBySession.computeIfAbsent(s.getSession().getId(), k -> new ArrayList<>()).add(s);
        }

        return workoutSessionRepository.findByPerson_IdOrderByStartedAtDesc(person.getId()).stream()
                .filter(session -> setsBySession.containsKey(session.getId()))
                .map(session -> toHistorySessionDto(session, setsBySession.get(session.getId())))
                .toList();
    }

    private HistorySessionDto toHistorySessionDto(WorkoutSession session, List<WorkoutSet> sessionSets) {
        Map<Long, List<WorkoutSet>> byExercise = new LinkedHashMap<>();
        for (WorkoutSet s : sessionSets) {
            byExercise.computeIfAbsent(s.getExercise().getId(), k -> new ArrayList<>()).add(s);
        }
        List<HistoryEntryDto> entries = byExercise.values().stream()
                .map(sets -> new HistoryEntryDto(
                        sets.get(0).getExercise().getId(),
                        sets.get(0).getExercise().getName(),
                        sets.stream().map(s -> new SetSummaryDto(s.getWeight(), s.getReps(), s.getUnit())).toList()))
                .toList();
        return new HistorySessionDto(session.getId(), session.getStartedAt(), session.getEndedAt(), session.isManual(), entries);
    }
}
