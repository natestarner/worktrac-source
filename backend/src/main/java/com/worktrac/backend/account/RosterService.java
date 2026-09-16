package com.worktrac.backend.account;

import com.worktrac.backend.membership.AccountAccess;
import com.worktrac.backend.membership.AccountMembership;
import com.worktrac.backend.membership.AccountMembershipRepository;
import com.worktrac.backend.person.PersonDto;
import com.worktrac.backend.person.PersonService;
import com.worktrac.backend.stats.WeeklyStreak;
import com.worktrac.backend.workoutsession.WorkoutSessionRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.DateTimeException;
import java.time.DayOfWeek;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * The roster: everyone this login can see, ordered by who has gone quietest.
 *
 * <p>A family has a person switcher and needs nothing more — six people, all in one house. A
 * trainer with forty clients has a different question, and it is always the same one: <i>who has
 * stopped showing up?</i> That is a question the app could not answer at all before this, because
 * every existing screen is built around one person at a time.
 *
 * <p><b>Quietest-first is the default sort for that reason</b> — the answer should be at the top
 * rather than found by scrolling. Someone who has never logged anything sorts first of all: they
 * are the most urgent case, not the least, and a "never" that sorted to the bottom is exactly the
 * client who quietly never started.
 *
 * <p>⚠️ <b>FOUR QUERIES, WHATEVER THE SIZE OF THE PRACTICE.</b> This is the one screen whose cost
 * scales with the roster, so the naive per-person shape is an N+1 across every client on every
 * open. {@code ExerciseAttributionResolver} is the worked example of the same rule for the exercise
 * catalogue. If you add a field here, add it as another grouped query — never a lookup inside the
 * mapping loop.
 *
 * <p><b>No plan gate, deliberately.</b> Every number here is derived from workouts the caller can
 * already read one person at a time, so gating the aggregate protects nothing — it would be a gate
 * whose only effect is to refuse a convenience. What Pro actually sells is the trainer-shaped
 * surface over this, not the existence of a list. A family on Plus reaching it sees their own
 * household, which is harmless and occasionally useful.
 */
@Service
public class RosterService {

    /**
     * How far back the streak may reach. Matches the consistency grid's 26 weeks, so the two agree
     * about how long a streak can be, and bounds the one query whose row count is unbounded.
     */
    private static final int STREAK_WINDOW_WEEKS = 26;

    private static final int DEFAULT_WINDOW_WEEKS = 4;
    private static final int MAX_WINDOW_WEEKS = STREAK_WINDOW_WEEKS;

    private final PersonService personService;
    private final AccountMembershipRepository membershipRepository;
    private final WorkoutSessionRepository sessionRepository;
    private final Clock clock;

    public RosterService(PersonService personService,
                         AccountMembershipRepository membershipRepository,
                         WorkoutSessionRepository sessionRepository,
                         Clock clock) {
        this.personService = personService;
        this.membershipRepository = membershipRepository;
        this.sessionRepository = sessionRepository;
        this.clock = clock;
    }

    @Transactional(readOnly = true)
    public List<RosterEntryDto> roster(AccountAccess access, String zone, Integer weeks) {
        ZoneId zoneId = resolveZone(zone);
        int windowWeeks = clampWindow(weeks);
        Instant now = clock.instant();
        LocalDate today = now.atZone(zoneId).toLocalDate();

        // ⚠️ Through personService.list, not the repository. That is what makes the roster obey
        // member visibility for free: a private client calling this sees exactly themselves, and a
        // family member with visibility on sees the household. Reading people directly here would
        // be a second answer to "who exists", and those drift.
        List<PersonDto> people = personService.list(access);

        Set<Long> peopleWithLogins = new HashSet<>();
        for (AccountMembership membership : membershipRepository.findByAccount_Id(access.accountId())) {
            if (membership.getPerson() != null) {
                peopleWithLogins.add(membership.getPerson().getId());
            }
        }

        Map<Long, Instant> lastWorkoutByPerson = new HashMap<>();
        for (Object[] row : sessionRepository.lastWorkoutGroupedByPerson(access.accountId())) {
            lastWorkoutByPerson.put((Long) row[0], (Instant) row[1]);
        }

        // The streak window is the wider of the two, so one query feeds both derivations.
        LocalDate currentWeekStart = weekStart(today);
        LocalDate earliestWeek = currentWeekStart.minusWeeks(STREAK_WINDOW_WEEKS);
        Instant since = earliestWeek.atStartOfDay(zoneId).toInstant();
        LocalDate windowStart = today.minusWeeks(windowWeeks);

        Map<Long, Set<LocalDate>> weeksTrainedByPerson = new HashMap<>();
        Map<Long, Integer> sessionsInWindowByPerson = new HashMap<>();
        for (Object[] row : sessionRepository.workoutTimesSince(access.accountId(), since)) {
            Long personId = (Long) row[0];
            LocalDate date = ((Instant) row[1]).atZone(zoneId).toLocalDate();

            weeksTrainedByPerson.computeIfAbsent(personId, id -> new HashSet<>()).add(weekStart(date));
            if (!date.isBefore(windowStart)) {
                sessionsInWindowByPerson.merge(personId, 1, Integer::sum);
            }
        }

        List<RosterEntryDto> entries = new ArrayList<>(people.size());
        for (PersonDto person : people) {
            Instant last = lastWorkoutByPerson.get(person.id());
            // Null rather than a sentinel: "never" is a different fact from "a very long time ago",
            // and the sort below treats it as more urgent rather than less.
            Integer daysSince = last == null
                    ? null
                    : (int) Duration.between(last.atZone(zoneId).toLocalDate().atStartOfDay(zoneId),
                            today.atStartOfDay(zoneId)).toDays();

            entries.add(new RosterEntryDto(
                    person.id(),
                    person.name(),
                    last,
                    daysSince,
                    sessionsInWindowByPerson.getOrDefault(person.id(), 0),
                    WeeklyStreak.consecutiveWeeks(
                            weeksTrainedByPerson.getOrDefault(person.id(), Set.of()),
                            currentWeekStart, earliestWeek),
                    peopleWithLogins.contains(person.id())));
        }

        entries.sort(QUIETEST_FIRST);
        return entries;
    }

    /**
     * Never-logged first, then longest-silent first, then by name.
     *
     * <p>The name tiebreak is not cosmetic: without a total order the list can come back in a
     * different sequence on two consecutive loads for people whose numbers match — which on a
     * roster of clients who all trained yesterday is most of them.
     */
    private static final Comparator<RosterEntryDto> QUIETEST_FIRST = Comparator
            .comparing((RosterEntryDto e) -> e.daysSinceLastWorkout() == null ? 0 : 1)
            .thenComparing(e -> e.daysSinceLastWorkout() == null ? 0 : -e.daysSinceLastWorkout())
            .thenComparing(RosterEntryDto::personName, Comparator.nullsLast(String::compareToIgnoreCase));

    /** Weeks start Monday, matching the consistency grid and StatsService's bucketing. */
    private static LocalDate weekStart(LocalDate date) {
        return date.with(DayOfWeek.MONDAY);
    }

    /**
     * Bounded rather than rejected. An out-of-range window is a client bug, and answering a clamped
     * roster is more useful than a 400 on a read that has no other way to degrade.
     */
    private static int clampWindow(Integer weeks) {
        if (weeks == null) {
            return DEFAULT_WINDOW_WEEKS;
        }
        return Math.max(1, Math.min(MAX_WINDOW_WEEKS, weeks));
    }

    // Same fallback as StatsService.resolveZone: an unrecognised zone degrades to UTC rather than
    // failing a read. Duplicated rather than shared because sharing it would mean this package
    // depending on stats for two lines -- if a third caller appears, extract it then.
    private static ZoneId resolveZone(String zone) {
        try {
            return ZoneId.of(zone);
        } catch (DateTimeException | NullPointerException e) {
            return ZoneOffset.UTC;
        }
    }
}
