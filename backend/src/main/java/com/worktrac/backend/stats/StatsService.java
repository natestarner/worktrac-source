package com.worktrac.backend.stats;

import com.worktrac.backend.exercise.Exercise;
import com.worktrac.backend.person.Person;
import com.worktrac.backend.person.PersonService;
import com.worktrac.backend.sessionexercisenote.SessionExerciseNote;
import com.worktrac.backend.sessionexercisenote.SessionExerciseNoteRepository;
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
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.TreeMap;

@Service
public class StatsService {

    // Caps how far back "all time" trend ranges reach, so a household with years of
    // history never sends an unbounded number of weekly chart points to the client.
    private static final int MAX_WEEKS = 260;

    // The consistency heatmap always renders a fixed trailing window rather than following the
    // range toggle: at 4wk it would be four columns wide (reads as broken) and at "All" it would
    // be 260 columns (unusable on a phone). Six months is 26 columns of 7 day-squares, which fits
    // an iPhone without scrolling.
    private static final int HEATMAP_DAYS = 182;

    // "Recent" PRs, and how many to send. The cap is a transport guard, not a display choice --
    // someone starting out sets a first-ever PR on every exercise they touch.
    private static final int RECENT_PR_DAYS = 30;
    private static final int MAX_RECENT_PRS = 20;

    // Rep targets for the records table, interpreted as "at least this many reps" -- see RepMaxDto.
    private static final List<Integer> REP_MAX_TARGETS = List.of(1, 3, 5, 8, 10, 12);

    private final WorkoutSetRepository workoutSetRepository;
    private final SessionExerciseNoteRepository sessionExerciseNoteRepository;
    private final PersonService personService;
    private final EpleyCalculator epleyCalculator;
    private final UnitConverter unitConverter;
    private final Clock clock;

    public StatsService(WorkoutSetRepository workoutSetRepository, SessionExerciseNoteRepository sessionExerciseNoteRepository,
                         PersonService personService, EpleyCalculator epleyCalculator, UnitConverter unitConverter, Clock clock) {
        this.workoutSetRepository = workoutSetRepository;
        this.sessionExerciseNoteRepository = sessionExerciseNoteRepository;
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
        String note = sessionExerciseNoteRepository.findBySession_IdAndExercise_Id(bestSessionId, exerciseId)
                .map(SessionExerciseNote::getNote)
                .orElse(null);
        return Optional.of(new LastSessionDto(bestSessionId, bestStartedAt, sets, note));
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
        Map<Long, Integer> sessionSetCount = new LinkedHashMap<>();
        Map<Long, Integer> sessionRepCount = new LinkedHashMap<>();
        for (WorkoutSet s : all) {
            Long sessionId = s.getSession().getId();
            LocalDate date = LocalDate.ofInstant(s.getSession().getStartedAt(), zoneId);
            sessionDate.putIfAbsent(sessionId, date);
            BigDecimal volumeLb = unitConverter.toLb(s.getWeight().multiply(BigDecimal.valueOf(s.getReps())), s.getUnit());
            sessionVolumeLb.merge(sessionId, volumeLb, BigDecimal::add);
            sessionSetCount.merge(sessionId, 1, Integer::sum);
            sessionRepCount.merge(sessionId, s.getReps(), Integer::sum);
        }

        Map<LocalDate, Integer> workoutCountByWeek = new LinkedHashMap<>();
        Map<LocalDate, BigDecimal> volumeByWeek = new LinkedHashMap<>();
        Map<LocalDate, Integer> setsByWeek = new LinkedHashMap<>();
        Map<LocalDate, Integer> repsByWeek = new LinkedHashMap<>();
        for (LocalDate w = rangeStart; !w.isAfter(currentWeekStart); w = w.plusWeeks(1)) {
            workoutCountByWeek.put(w, 0);
            volumeByWeek.put(w, BigDecimal.ZERO);
            setsByWeek.put(w, 0);
            repsByWeek.put(w, 0);
        }
        for (Map.Entry<Long, LocalDate> entry : sessionDate.entrySet()) {
            LocalDate weekStart = entry.getValue().with(DayOfWeek.MONDAY);
            if (weekStart.isBefore(rangeStart) || weekStart.isAfter(currentWeekStart)) {
                continue;
            }
            workoutCountByWeek.merge(weekStart, 1, Integer::sum);
            volumeByWeek.merge(weekStart, sessionVolumeLb.getOrDefault(entry.getKey(), BigDecimal.ZERO), BigDecimal::add);
            setsByWeek.merge(weekStart, sessionSetCount.getOrDefault(entry.getKey(), 0), Integer::sum);
            repsByWeek.merge(weekStart, sessionRepCount.getOrDefault(entry.getKey(), 0), Integer::sum);
        }

        List<WeeklyPointDto> weeklyPoints = workoutCountByWeek.entrySet().stream()
                .map(e -> new WeeklyPointDto(e.getKey(), e.getValue(),
                        volumeByWeek.get(e.getKey()).setScale(1, RoundingMode.HALF_UP),
                        setsByWeek.get(e.getKey()), repsByWeek.get(e.getKey())))
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
                volumeLastMonthLb.setScale(1, RoundingMode.HALF_UP),
                buildWorkoutDays(sessionDate, sessionSetCount, today),
                buildRecentPrs(all, sessionDate, today),
                !all.isEmpty());
    }

    // Days with at least one session in the fixed trailing heatmap window, ascending. Only active
    // days are emitted -- the client draws the blank squares, so six months of 3x/week training is
    // ~78 entries rather than 182.
    private List<WorkoutDayDto> buildWorkoutDays(Map<Long, LocalDate> sessionDate,
                                                  Map<Long, Integer> sessionSetCount, LocalDate today) {
        LocalDate windowStart = today.minusDays(HEATMAP_DAYS - 1L);
        Map<LocalDate, int[]> byDay = new TreeMap<>();
        for (Map.Entry<Long, LocalDate> entry : sessionDate.entrySet()) {
            LocalDate date = entry.getValue();
            if (date.isBefore(windowStart) || date.isAfter(today)) {
                continue;
            }
            int[] totals = byDay.computeIfAbsent(date, k -> new int[2]);
            totals[0]++;
            totals[1] += sessionSetCount.getOrDefault(entry.getKey(), 0);
        }
        return byDay.entrySet().stream()
                .map(e -> new WorkoutDayDto(e.getKey(), e.getValue()[0], e.getValue()[1]))
                .toList();
    }

    // Replays every set in training-date order, per exercise, and keeps the ones that beat the
    // running best -- the same rule getExerciseTrend uses, just across all exercises at once.
    //
    // Ordering is by the session's startedAt, NOT the set's createdAt, because a workout logged
    // retroactively through "Log a past workout" is inserted today but happened weeks ago; sorting
    // by insert order would let it overwrite the running best out of sequence and wrongly demote
    // the PRs that came after it. One consequence worth knowing: this can disagree with the PR
    // celebration that fired at log time (WorkoutSetService compares against the best known at
    // INSERT time), and that is deliberate -- the trend chart already has the same semantics.
    private List<RecentPrDto> buildRecentPrs(List<WorkoutSet> all, Map<Long, LocalDate> sessionDate, LocalDate today) {
        LocalDate windowStart = today.minusDays(RECENT_PR_DAYS - 1L);
        List<WorkoutSet> chronological = all.stream()
                .sorted(Comparator.comparing((WorkoutSet s) -> s.getSession().getStartedAt())
                        .thenComparing(WorkoutSet::getCreatedAt))
                .toList();

        Map<Long, BigDecimal> runningBestByExercise = new HashMap<>();
        List<RecentPrDto> prs = new ArrayList<>();
        for (WorkoutSet s : chronological) {
            Long exerciseId = s.getExercise().getId();
            BigDecimal comparable = comparableLb(s.getWeight(), s.getReps(), s.getUnit());
            if (comparable.compareTo(runningBestByExercise.getOrDefault(exerciseId, BigDecimal.ZERO)) <= 0) {
                continue;
            }
            runningBestByExercise.put(exerciseId, comparable);

            // Older PRs still have to advance the running best above, they just aren't reported.
            LocalDate date = sessionDate.get(s.getSession().getId());
            if (date.isBefore(windowStart) || date.isAfter(today)) {
                continue;
            }
            BigDecimal est1rmLb = unitConverter.toLb(epleyCalculator.estimate1RM(s.getWeight(), s.getReps()), s.getUnit());
            prs.add(new RecentPrDto(date, exerciseId, s.getExercise().getName(),
                    unitConverter.toLb(s.getWeight(), s.getUnit()).setScale(1, RoundingMode.HALF_UP),
                    s.getReps(),
                    est1rmLb.setScale(1, RoundingMode.HALF_UP)));
        }
        return prs.reversed().stream().limit(MAX_RECENT_PRS).toList();
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
            List<WorkoutSet> sessionSets = entry.getValue();
            WorkoutSet best = bestSet(sessionSets).orElseThrow();
            BigDecimal weightLb = unitConverter.toLb(best.getWeight(), best.getUnit());
            BigDecimal est1rmLb = comparableLb(best.getWeight(), best.getReps(), best.getUnit());
            boolean isPr = est1rmLb.compareTo(runningBestLb) > 0;
            if (isPr) {
                runningBestLb = est1rmLb;
            }

            // The other four ways to read the same session, so the client's metric switcher plots
            // all of them from this one response. Note heaviestWeight is genuinely a different set
            // from `best` much of the time -- 225x1 tops the bar but loses to 185x8 on est. 1RM.
            BigDecimal heaviestWeightLb = null;
            int heaviestWeightReps = 0;
            BigDecimal bestSetVolumeLb = BigDecimal.ZERO;
            BigDecimal sessionVolumeLb = BigDecimal.ZERO;
            int totalReps = 0;
            for (WorkoutSet s : sessionSets) {
                BigDecimal setWeightLb = unitConverter.toLb(s.getWeight(), s.getUnit());
                // Ties broken by reps so an all-bodyweight session reports its best rep set rather
                // than whichever 0-weight set happened to come first.
                int weightComparison = heaviestWeightLb == null ? 1 : setWeightLb.compareTo(heaviestWeightLb);
                if (weightComparison > 0 || (weightComparison == 0 && s.getReps() > heaviestWeightReps)) {
                    heaviestWeightLb = setWeightLb;
                    heaviestWeightReps = s.getReps();
                }
                BigDecimal setVolumeLb = setWeightLb.multiply(BigDecimal.valueOf(s.getReps()));
                if (setVolumeLb.compareTo(bestSetVolumeLb) > 0) {
                    bestSetVolumeLb = setVolumeLb;
                }
                sessionVolumeLb = sessionVolumeLb.add(setVolumeLb);
                totalReps += s.getReps();
            }

            LocalDate date = LocalDate.ofInstant(best.getSession().getStartedAt(), zoneId);
            points.add(new ExerciseTrendPointDto(date, best.getSession().getId(),
                    weightLb.setScale(1, RoundingMode.HALF_UP), best.getReps(),
                    est1rmLb.setScale(1, RoundingMode.HALF_UP), isPr,
                    heaviestWeightLb.setScale(1, RoundingMode.HALF_UP), heaviestWeightReps,
                    bestSetVolumeLb.setScale(1, RoundingMode.HALF_UP),
                    sessionVolumeLb.setScale(1, RoundingMode.HALF_UP),
                    totalReps, sessionSets.size()));
        }
        return points;
    }

    // All-time records for one exercise, deliberately not range-scoped -- see ExerciseRecordsDto.
    // One pass over the same per-exercise query getBest/getExerciseTrend already use; no new
    // repository method and no second full-history load.
    @Transactional(readOnly = true)
    public ExerciseRecordsDto getExerciseRecords(Long accountId, Long personId, Long exerciseId, String zone) {
        Person person = personService.requireOwnedPerson(personId, accountId);
        ZoneId zoneId = resolveZone(zone);
        List<WorkoutSet> all = workoutSetRepository.findByPerson_IdAndExercise_Id(person.getId(), exerciseId);
        if (all.isEmpty()) {
            return new ExerciseRecordsDto(List.of(), null, null, null, null, 0, 0,
                    BigDecimal.ZERO.setScale(1, RoundingMode.HALF_UP), false);
        }

        WorkoutSet heaviest = null;
        WorkoutSet bestSetVolume = null;
        WorkoutSet mostReps = null;
        int totalReps = 0;
        BigDecimal totalVolumeLb = BigDecimal.ZERO;
        boolean bodyweightOnly = true;
        Map<Long, BigDecimal> volumeBySession = new LinkedHashMap<>();
        Map<Long, WorkoutSet> anySetInSession = new LinkedHashMap<>();

        for (WorkoutSet s : all) {
            BigDecimal weightLb = unitConverter.toLb(s.getWeight(), s.getUnit());
            BigDecimal setVolumeLb = weightLb.multiply(BigDecimal.valueOf(s.getReps()));

            // Heaviest weight, more reps as the tiebreak.
            if (heaviest == null || isBetter(weightLb, reps(s), lbWeight(heaviest), reps(heaviest))) {
                heaviest = s;
            }
            if (bestSetVolume == null || setVolumeLb.compareTo(setVolumeLb(bestSetVolume)) > 0) {
                bestSetVolume = s;
            }
            // The mirror of `heaviest`: most reps, heavier weight as the tiebreak.
            if (mostReps == null || isBetter(reps(s), weightLb, reps(mostReps), lbWeight(mostReps))) {
                mostReps = s;
            }

            totalReps += s.getReps();
            totalVolumeLb = totalVolumeLb.add(setVolumeLb);
            if (s.getWeight().compareTo(BigDecimal.ZERO) != 0) {
                bodyweightOnly = false;
            }
            volumeBySession.merge(s.getSession().getId(), setVolumeLb, BigDecimal::add);
            anySetInSession.putIfAbsent(s.getSession().getId(), s);
        }

        Map.Entry<Long, BigDecimal> bestSession = volumeBySession.entrySet().stream()
                .max(Map.Entry.comparingByValue())
                .orElseThrow();

        return new ExerciseRecordsDto(
                buildRepMaxes(all, zoneId),
                toRecordEntry(lbWeight(heaviest), heaviest, zoneId),
                toRecordEntry(setVolumeLb(bestSetVolume), bestSetVolume, zoneId),
                new RecordEntryDto(bestSession.getValue().setScale(1, RoundingMode.HALF_UP), null, null,
                        sessionDate(anySetInSession.get(bestSession.getKey()), zoneId)),
                toRecordEntry(BigDecimal.valueOf(mostReps.getReps()), mostReps, zoneId),
                all.size(),
                totalReps,
                totalVolumeLb.setScale(1, RoundingMode.HALF_UP),
                bodyweightOnly);
    }

    // For each target, the heaviest weight ever lifted for AT LEAST that many reps. Ties on weight
    // go to the higher rep count, so "185 x 8" wins over "185 x 5" under the 5+ target.
    private List<RepMaxDto> buildRepMaxes(List<WorkoutSet> all, ZoneId zoneId) {
        List<RepMaxDto> repMaxes = new ArrayList<>();
        for (int target : REP_MAX_TARGETS) {
            WorkoutSet best = null;
            for (WorkoutSet s : all) {
                if (s.getReps() < target) {
                    continue;
                }
                if (best == null || isBetter(lbWeight(s), reps(s), lbWeight(best), reps(best))) {
                    best = s;
                }
            }
            repMaxes.add(best == null
                    ? new RepMaxDto(target, null, null, null)
                    : new RepMaxDto(target, lbWeight(best).setScale(1, RoundingMode.HALF_UP),
                            best.getReps(), sessionDate(best, zoneId)));
        }
        return repMaxes;
    }

    // "Is (value, tiebreak) a better record than the incumbent?" -- strictly greater on value, or
    // equal on value and strictly greater on the tiebreak. Both sides stay BigDecimal so a weight
    // used as a tiebreak keeps its fraction (22.5 vs 22.7 must not both truncate to 22).
    private boolean isBetter(BigDecimal value, BigDecimal tiebreak, BigDecimal bestValue, BigDecimal bestTiebreak) {
        int comparison = value.compareTo(bestValue);
        return comparison > 0 || (comparison == 0 && tiebreak.compareTo(bestTiebreak) > 0);
    }

    private BigDecimal reps(WorkoutSet set) {
        return BigDecimal.valueOf(set.getReps());
    }

    private BigDecimal lbWeight(WorkoutSet set) {
        return unitConverter.toLb(set.getWeight(), set.getUnit());
    }

    private BigDecimal setVolumeLb(WorkoutSet set) {
        return lbWeight(set).multiply(BigDecimal.valueOf(set.getReps()));
    }

    private LocalDate sessionDate(WorkoutSet set, ZoneId zoneId) {
        return LocalDate.ofInstant(set.getSession().getStartedAt(), zoneId);
    }

    private RecordEntryDto toRecordEntry(BigDecimal valueLb, WorkoutSet set, ZoneId zoneId) {
        return new RecordEntryDto(valueLb.setScale(1, RoundingMode.HALF_UP),
                lbWeight(set).setScale(1, RoundingMode.HALF_UP), set.getReps(), sessionDate(set, zoneId));
    }
}
