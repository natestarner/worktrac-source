package com.worktrac.backend.stats;

import com.worktrac.backend.exercise.Exercise;
import com.worktrac.backend.person.Person;
import com.worktrac.backend.person.PersonService;
import com.worktrac.backend.workoutset.WorkoutSet;
import com.worktrac.backend.workoutset.WorkoutSetRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Clock;
import java.time.DateTimeException;
import java.time.DayOfWeek;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

@Service
public class StatsService {

    // Caps how far back "all time" trend ranges reach, so a household with years of
    // history never sends an unbounded number of weekly chart points to the client.
    private static final int MAX_WEEKS = 260;

    private final WorkoutSetRepository workoutSetRepository;
    private final PersonService personService;
    private final EpleyCalculator epleyCalculator;
    private final UnitConverter unitConverter;
    private final Clock clock;

    public StatsService(WorkoutSetRepository workoutSetRepository, PersonService personService,
                         EpleyCalculator epleyCalculator, UnitConverter unitConverter, Clock clock) {
        this.workoutSetRepository = workoutSetRepository;
        this.personService = personService;
        this.epleyCalculator = epleyCalculator;
        this.unitConverter = unitConverter;
        this.clock = clock;
    }

    @Transactional(readOnly = true)
    public ExerciseSummaryDto getSummary(Long accountId, Long personId, Long exerciseId, Long excludeSessionId) {
        Person person = personService.requireOwnedPerson(personId, accountId);
        LastSessionDto lastSession = getLastSession(person.getId(), exerciseId, excludeSessionId).orElse(null);
        BestDto best = getBest(person.getId(), exerciseId).orElse(null);
        return new ExerciseSummaryDto(lastSession, best);
    }

    // Max estimated 1RM across every set ever logged for this person + exercise,
    // regardless of session, compared across units when mixed but displayed in the
    // set's own original unit.
    public Optional<BestDto> getBest(Long personId, Long exerciseId) {
        return bestSet(workoutSetRepository.findByPerson_IdAndExercise_Id(personId, exerciseId))
                .map(this::toBestDto);
    }

    // The sets from the most recent *other* session (excluding excludeSessionId) for
    // this person + exercise.
    public Optional<LastSessionDto> getLastSession(Long personId, Long exerciseId, Long excludeSessionId) {
        List<WorkoutSet> all = workoutSetRepository.findByPerson_IdAndExercise_Id(personId, exerciseId);
        Long bestSessionId = null;
        java.time.Instant bestStartedAt = null;
        for (WorkoutSet s : all) {
            if (excludeSessionId != null && s.getSession().getId().equals(excludeSessionId)) {
                continue;
            }
            java.time.Instant startedAt = s.getSession().getStartedAt();
            if (bestStartedAt == null || startedAt.isAfter(bestStartedAt)) {
                bestStartedAt = startedAt;
                bestSessionId = s.getSession().getId();
            }
        }
        if (bestSessionId == null) {
            return Optional.empty();
        }
        Long finalBestSessionId = bestSessionId;
        List<SetSummaryDto> sets = all.stream()
                .filter(s -> s.getSession().getId().equals(finalBestSessionId))
                .sorted(Comparator.comparing(WorkoutSet::getCreatedAt))
                .map(s -> new SetSummaryDto(s.getWeight(), s.getReps(), s.getUnit()))
                .toList();
        return Optional.of(new LastSessionDto(bestSessionId, bestStartedAt, sets));
    }

    @Transactional(readOnly = true)
    public List<PrRowDto> getPrList(Long accountId, Long personId) {
        Person person = personService.requireOwnedPerson(personId, accountId);
        List<WorkoutSet> all = workoutSetRepository.findByPerson_IdOrderByCreatedAtAsc(person.getId());

        Map<Long, List<WorkoutSet>> byExercise = new LinkedHashMap<>();
        for (WorkoutSet s : all) {
            byExercise.computeIfAbsent(s.getExercise().getId(), k -> new java.util.ArrayList<>()).add(s);
        }

        return byExercise.values().stream()
                .map(sets -> {
                    Exercise exercise = sets.get(0).getExercise();
                    WorkoutSet best = bestSet(sets).orElseThrow();
                    return new PrRowDto(exercise.getId(), exercise.getName(), toBestDto(best));
                })
                .sorted(Comparator.comparing(PrRowDto::exerciseName, String.CASE_INSENSITIVE_ORDER))
                .toList();
    }

    private Optional<WorkoutSet> bestSet(List<WorkoutSet> sets) {
        WorkoutSet best = null;
        BigDecimal bestComparableLb = null;
        for (WorkoutSet s : sets) {
            BigDecimal comparableLb = comparableLb(s.getWeight(), s.getReps(), s.getUnit());
            if (bestComparableLb == null || comparableLb.compareTo(bestComparableLb) > 0) {
                bestComparableLb = comparableLb;
                best = s;
            }
        }
        return Optional.ofNullable(best);
    }

    private BestDto toBestDto(WorkoutSet set) {
        BigDecimal est1rm = epleyCalculator.estimate1RM(set.getWeight(), set.getReps());
        return new BestDto(set.getWeight(), set.getReps(), set.getUnit(), est1rm, set.getSession().getStartedAt());
    }

    // Used by WorkoutSetService to determine isPR when logging a new set: the previous
    // best must be read BEFORE the new set is inserted, and compared in a common unit.
    public Optional<BigDecimal> getBestComparableLb(Long personId, Long exerciseId) {
        return bestSet(workoutSetRepository.findByPerson_IdAndExercise_Id(personId, exerciseId))
                .map(s -> comparableLb(s.getWeight(), s.getReps(), s.getUnit()));
    }

    // Epley's formula multiplies weight by a reps-based factor, so at weight == 0 (a
    // bodyweight set logged with no added load) it collapses to 0 no matter how many
    // reps were done -- every bodyweight set would then compare as an exact tie forever,
    // which both hides genuine rep-count improvement as a new PR and, worse, flags every
    // single bodyweight set as "matching" the all-time best (see isPrSet in
    // frontend/src/utils/formulas.js, which mirrors this). Reps are the only real signal
    // of performance at zero added weight, so use rep count directly as the comparable
    // value in that case instead of running it through Epley.
    public BigDecimal comparableLb(BigDecimal weight, int reps, String unit) {
        if (weight.compareTo(BigDecimal.ZERO) == 0) {
            return BigDecimal.valueOf(reps);
        }
        return unitConverter.toLb(epleyCalculator.estimate1RM(weight, reps), unit);
    }

    // "Today"/"this week" only mean the same thing to the viewer as to this bucketing if
    // we use their local calendar, not the server's UTC storage zone -- a session logged
    // late evening in a negative-UTC-offset zone would otherwise land on the wrong day.
    // Falls back to UTC for a missing/unrecognized zone rather than failing the request.
    private ZoneId resolveZone(String zone) {
        try {
            return ZoneId.of(zone);
        } catch (DateTimeException | NullPointerException e) {
            return ZoneOffset.UTC;
        }
    }

    @Transactional(readOnly = true)
    public TrendsOverviewDto getOverview(Long accountId, Long personId, int weeks, String zone) {
        Person person = personService.requireOwnedPerson(personId, accountId);
        int effectiveWeeks = Math.min(Math.max(weeks, 1), MAX_WEEKS);
        ZoneId zoneId = resolveZone(zone);

        LocalDate today = LocalDate.ofInstant(clock.instant(), zoneId);
        LocalDate currentWeekStart = today.with(DayOfWeek.MONDAY);
        LocalDate rangeStart = currentWeekStart.minusWeeks(effectiveWeeks - 1L);

        List<WorkoutSet> all = workoutSetRepository.findByPerson_IdOrderByCreatedAtAsc(person.getId());

        // Collapse to one entry per session (not per set) so a session with many sets only
        // counts once toward workoutCount, while still summing every set's volume.
        Map<Long, LocalDate> sessionDate = new LinkedHashMap<>();
        Map<Long, BigDecimal> sessionVolumeLb = new LinkedHashMap<>();
        for (WorkoutSet s : all) {
            Long sessionId = s.getSession().getId();
            LocalDate date = LocalDate.ofInstant(s.getSession().getStartedAt(), zoneId);
            sessionDate.putIfAbsent(sessionId, date);
            BigDecimal volumeLb = unitConverter.toLb(s.getWeight().multiply(BigDecimal.valueOf(s.getReps())), s.getUnit());
            sessionVolumeLb.merge(sessionId, volumeLb, BigDecimal::add);
        }

        Map<LocalDate, Integer> workoutCountByWeek = new LinkedHashMap<>();
        Map<LocalDate, BigDecimal> volumeByWeek = new LinkedHashMap<>();
        for (LocalDate w = rangeStart; !w.isAfter(currentWeekStart); w = w.plusWeeks(1)) {
            workoutCountByWeek.put(w, 0);
            volumeByWeek.put(w, BigDecimal.ZERO);
        }
        for (Map.Entry<Long, LocalDate> entry : sessionDate.entrySet()) {
            LocalDate weekStart = entry.getValue().with(DayOfWeek.MONDAY);
            if (weekStart.isBefore(rangeStart) || weekStart.isAfter(currentWeekStart)) {
                continue;
            }
            workoutCountByWeek.merge(weekStart, 1, Integer::sum);
            volumeByWeek.merge(weekStart, sessionVolumeLb.getOrDefault(entry.getKey(), BigDecimal.ZERO), BigDecimal::add);
        }

        List<WeeklyPointDto> weeklyPoints = workoutCountByWeek.entrySet().stream()
                .map(e -> new WeeklyPointDto(e.getKey(), e.getValue(), volumeByWeek.get(e.getKey()).setScale(1, RoundingMode.HALF_UP)))
                .toList();

        // Current week doesn't break the streak just because it's still in progress --
        // start counting from last week if this week has no workouts logged yet.
        LocalDate cursor = workoutCountByWeek.getOrDefault(currentWeekStart, 0) > 0
                ? currentWeekStart
                : currentWeekStart.minusWeeks(1);
        int currentStreakWeeks = 0;
        while (!cursor.isBefore(rangeStart) && workoutCountByWeek.getOrDefault(cursor, 0) > 0) {
            currentStreakWeeks++;
            cursor = cursor.minusWeeks(1);
        }

        LocalDate thisWindowStart = today.minusDays(29);
        LocalDate lastWindowStart = today.minusDays(59);
        LocalDate lastWindowEnd = today.minusDays(30);
        BigDecimal volumeThisMonthLb = BigDecimal.ZERO;
        BigDecimal volumeLastMonthLb = BigDecimal.ZERO;
        for (WorkoutSet s : all) {
            LocalDate date = sessionDate.get(s.getSession().getId());
            if (!date.isBefore(thisWindowStart) && !date.isAfter(today)) {
                BigDecimal volumeLb = unitConverter.toLb(s.getWeight().multiply(BigDecimal.valueOf(s.getReps())), s.getUnit());
                volumeThisMonthLb = volumeThisMonthLb.add(volumeLb);
            } else if (!date.isBefore(lastWindowStart) && !date.isAfter(lastWindowEnd)) {
                BigDecimal volumeLb = unitConverter.toLb(s.getWeight().multiply(BigDecimal.valueOf(s.getReps())), s.getUnit());
                volumeLastMonthLb = volumeLastMonthLb.add(volumeLb);
            }
        }

        return new TrendsOverviewDto(
                weeklyPoints,
                currentStreakWeeks,
                workoutCountByWeek.getOrDefault(currentWeekStart, 0),
                workoutCountByWeek.getOrDefault(currentWeekStart.minusWeeks(1), 0),
                volumeThisMonthLb.setScale(1, RoundingMode.HALF_UP),
                volumeLastMonthLb.setScale(1, RoundingMode.HALF_UP));
    }

    @Transactional(readOnly = true)
    public List<ExerciseTrendPointDto> getExerciseTrend(Long accountId, Long personId, Long exerciseId, int weeks, String zone) {
        Person person = personService.requireOwnedPerson(personId, accountId);
        int effectiveWeeks = Math.min(Math.max(weeks, 1), MAX_WEEKS);
        ZoneId zoneId = resolveZone(zone);

        LocalDate today = LocalDate.ofInstant(clock.instant(), zoneId);
        LocalDate rangeStart = today.with(DayOfWeek.MONDAY).minusWeeks(effectiveWeeks - 1L);

        List<WorkoutSet> all = workoutSetRepository.findByPerson_IdAndExercise_Id(person.getId(), exerciseId);

        // Seed the running best from everything before the window so a PR from outside the
        // requested range isn't wrongly re-flagged as new once it scrolls into view.
        BigDecimal runningBestLb = BigDecimal.ZERO;
        Map<Long, List<WorkoutSet>> sessionsInWindow = new LinkedHashMap<>();
        for (WorkoutSet s : all) {
            LocalDate date = LocalDate.ofInstant(s.getSession().getStartedAt(), zoneId);
            if (date.isBefore(rangeStart)) {
                BigDecimal estLb = comparableLb(s.getWeight(), s.getReps(), s.getUnit());
                if (estLb.compareTo(runningBestLb) > 0) {
                    runningBestLb = estLb;
                }
            } else {
                sessionsInWindow.computeIfAbsent(s.getSession().getId(), k -> new ArrayList<>()).add(s);
            }
        }

        List<Map.Entry<Long, List<WorkoutSet>>> orderedSessions = sessionsInWindow.entrySet().stream()
                .sorted(Comparator.comparing(e -> e.getValue().get(0).getSession().getStartedAt()))
                .toList();

        List<ExerciseTrendPointDto> points = new ArrayList<>();
        for (Map.Entry<Long, List<WorkoutSet>> entry : orderedSessions) {
            WorkoutSet best = bestSet(entry.getValue()).orElseThrow();
            BigDecimal weightLb = unitConverter.toLb(best.getWeight(), best.getUnit());
            BigDecimal est1rmLb = comparableLb(best.getWeight(), best.getReps(), best.getUnit());
            boolean isPr = est1rmLb.compareTo(runningBestLb) > 0;
            if (isPr) {
                runningBestLb = est1rmLb;
            }
            LocalDate date = LocalDate.ofInstant(best.getSession().getStartedAt(), zoneId);
            points.add(new ExerciseTrendPointDto(date, best.getSession().getId(),
                    weightLb.setScale(1, RoundingMode.HALF_UP), best.getReps(),
                    est1rmLb.setScale(1, RoundingMode.HALF_UP), isPr));
        }
        return points;
    }
}
