package com.worktrac.backend.stats;

import com.worktrac.backend.billing.SubscriptionService;
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
import java.time.Instant;
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

    private final WorkoutSetRepository workoutSetRepository;
    private final SessionExerciseNoteRepository sessionExerciseNoteRepository;
    private final PersonService personService;
    private final EpleyCalculator epleyCalculator;
    private final UnitConverter unitConverter;
    private final SubscriptionService subscriptionService;
    private final Clock clock;

    public StatsService(WorkoutSetRepository workoutSetRepository, SessionExerciseNoteRepository sessionExerciseNoteRepository,
                         PersonService personService, EpleyCalculator epleyCalculator, UnitConverter unitConverter,
                         SubscriptionService subscriptionService, Clock clock) {
        this.workoutSetRepository = workoutSetRepository;
        this.sessionExerciseNoteRepository = sessionExerciseNoteRepository;
        this.personService = personService;
        this.epleyCalculator = epleyCalculator;
        this.unitConverter = unitConverter;
        this.subscriptionService = subscriptionService;
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
                .map(s -> new SetSummaryDto(s.getWeight(), s.getReps(), s.getDurationSeconds(), s.getUnit()))
                .toList();
        String note = sessionExerciseNoteRepository.findBySession_IdAndExercise_Id(bestSessionId, exerciseId)
                .map(SessionExerciseNote::getNote)
                .orElse(null);
        return Optional.of(new LastSessionDto(bestSessionId, bestStartedAt, sets, note));
    }

    @Transactional(readOnly = true)
    public List<PrRowDto> getPrList(Long accountId, Long personId) {
        Person person = personService.requireOwnedPerson(personId, accountId);
        List<WorkoutSet> all = workoutSetRepository.findByPerson_IdOrderByCreatedAtAscIdAsc(person.getId());

        // The Free-tier window, applied to what is DISPLAYED. Note this is deliberately NOT applied
        // to getBestComparableValue below, which is what WorkoutSetService asks when deciding
        // whether a new set is a PR: detection reads the person's whole history, so a Free
        // household is never congratulated for beating a 90-day best that is not their real best.
        // Telling someone they set a record they did not set is worse than withholding one.
        Instant floor = subscriptionService.historyFloor(accountId);

        Map<Long, List<WorkoutSet>> byExercise = new LinkedHashMap<>();
        for (WorkoutSet s : all) {
            if (!SubscriptionService.isVisible(floor, s.getSession().getStartedAt())) continue;
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
        BigDecimal bestComparable = null;
        for (WorkoutSet s : sets) {
            BigDecimal comparable = comparableValue(s.getWeight(), s.getReps(), s.getDurationSeconds(), s.getUnit());
            if (bestComparable == null || comparable.compareTo(bestComparable) > 0) {
                bestComparable = comparable;
                best = s;
            }
        }
        return Optional.ofNullable(best);
    }

    private BestDto toBestDto(WorkoutSet set) {
        // A hold has no est. 1RM -- Epley over 0 reps is meaningless, and labelling seconds as a
        // weight is the "rep count wearing a costume" mistake the bodyweight branch exists to
        // avoid. The record for a hold is its duration, which the DTO carries directly.
        BigDecimal est1rm = set.getDurationSeconds() != null
                ? null
                : epleyCalculator.estimate1RM(set.getWeight(), set.getReps());
        return new BestDto(set.getWeight(), set.getReps(), set.getDurationSeconds(), set.getUnit(), est1rm,
                set.getSession().getStartedAt());
    }

    // Used by WorkoutSetService to determine isPR when logging a new set: the previous
    // best must be read BEFORE the new set is inserted, and compared in a common unit.
    public Optional<BigDecimal> getBestComparableValue(Long personId, Long exerciseId) {
        return bestSet(workoutSetRepository.findByPerson_IdAndExercise_Id(personId, exerciseId))
                .map(s -> comparableValue(s.getWeight(), s.getReps(), s.getDurationSeconds(), s.getUnit()));
    }

    // The single number a set is ranked by. Every comparison this feeds is within ONE exercise, and
    // an exercise has exactly one measure, so seconds are never weighed against pounds.
    //
    // For a hold the value is the duration, and added load deliberately does NOT enter it: a
    // load-adjusted hold would need the person's bodyweight, which this app doesn't store, and
    // inventing a formula produces a number larger than anything they actually did. Load is
    // surfaced as its own record ("Heaviest load held") instead -- the same shape as heaviestWeight
    // sitting beside bestEst1rm rather than being fused into it.
    public BigDecimal comparableValue(BigDecimal weight, int reps, Integer durationSeconds, String unit) {
        if (durationSeconds != null) {
            return BigDecimal.valueOf(durationSeconds);
        }
        return comparableLb(weight, reps, unit);
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

    // Applies the Free-tier window to a set list before any aggregation. Filtering ONCE at the
    // source is what stops the weekly buckets, the consistency grid and the range totals from ever
    // disagreeing about which sessions count -- three aggregates derived from one filtered list
    // cannot drift, whereas three separate clamps could.
    //
    // Every row is still loaded and every row still exists: this is a read filter, never a delete.
    private List<WorkoutSet> visibleTo(Long accountId, List<WorkoutSet> sets) {
        Instant floor = subscriptionService.historyFloor(accountId);
        if (floor == null) return sets;
        return sets.stream()
                .filter(set -> SubscriptionService.isVisible(floor, set.getSession().getStartedAt()))
                .toList();
    }

    @Transactional(readOnly = true)
    public TrendsOverviewDto getOverview(Long accountId, Long personId, int weeks, String zone) {
        Person person = personService.requireOwnedPerson(personId, accountId);
        int effectiveWeeks = Math.min(Math.max(weeks, 1), MAX_WEEKS);
        ZoneId zoneId = resolveZone(zone);

        LocalDate today = LocalDate.ofInstant(clock.instant(), zoneId);
        LocalDate currentWeekStart = today.with(DayOfWeek.MONDAY);
        LocalDate rangeStart = currentWeekStart.minusWeeks(effectiveWeeks - 1L);

        List<WorkoutSet> loaded = workoutSetRepository.findByPerson_IdOrderByCreatedAtAscIdAsc(person.getId());

        // hasAnyHistory is read from the UNCLAMPED list, deliberately -- it is the one field on this
        // DTO that is all-time rather than range-scoped, and its entire job is separating a
        // brand-new person from a lapsed one so TrendsTab can pick between two different empty
        // states. Deriving it from `all` below made it answer the wrong question for exactly the
        // households it exists to serve: a Free household whose whole training history predates the
        // 90-day window got "No workouts logged yet. Trends will show up here once a few sessions
        // are in the books." -- told they had never trained, by the field added to stop that.
        // See .claude/rules/trends.md and .claude/rules/billing.md (the window is a read filter on
        // DISPLAY; it must never reshape what the app believes about the person).
        boolean hasAnyHistory = !loaded.isEmpty();

        List<WorkoutSet> all = visibleTo(accountId, loaded);

        // Collapse to one entry per session (not per set) so a session with many sets only
        // counts once toward workoutCount, while still summing every set's volume.
        Map<Long, LocalDate> sessionDate = new LinkedHashMap<>();
        Map<Long, BigDecimal> sessionVolumeLb = new LinkedHashMap<>();
        Map<Long, Integer> sessionSetCount = new LinkedHashMap<>();
        Map<Long, Integer> sessionRepCount = new LinkedHashMap<>();
        Map<Long, Integer> sessionHoldSeconds = new LinkedHashMap<>();
        for (WorkoutSet s : all) {
            Long sessionId = s.getSession().getId();
            LocalDate date = LocalDate.ofInstant(s.getSession().getStartedAt(), zoneId);
            sessionDate.putIfAbsent(sessionId, date);
            // A hold carries reps 0, so it contributes 0 volume and 0 reps here with no special
            // case -- that is exactly why reps is 0 rather than null (see WorkoutSet). Its work is
            // counted by sessionHoldSeconds and by the set count instead.
            BigDecimal volumeLb = unitConverter.toLb(s.getWeight().multiply(BigDecimal.valueOf(s.getReps())), s.getUnit());
            sessionVolumeLb.merge(sessionId, volumeLb, BigDecimal::add);
            sessionSetCount.merge(sessionId, 1, Integer::sum);
            sessionRepCount.merge(sessionId, s.getReps(), Integer::sum);
            sessionHoldSeconds.merge(sessionId, s.getDurationSeconds() == null ? 0 : s.getDurationSeconds(), Integer::sum);
        }

        Map<LocalDate, Integer> workoutCountByWeek = new LinkedHashMap<>();
        Map<LocalDate, BigDecimal> volumeByWeek = new LinkedHashMap<>();
        Map<LocalDate, Integer> setsByWeek = new LinkedHashMap<>();
        Map<LocalDate, Integer> repsByWeek = new LinkedHashMap<>();
        Map<LocalDate, Integer> holdSecondsByWeek = new LinkedHashMap<>();
        for (LocalDate w = rangeStart; !w.isAfter(currentWeekStart); w = w.plusWeeks(1)) {
            workoutCountByWeek.put(w, 0);
            volumeByWeek.put(w, BigDecimal.ZERO);
            setsByWeek.put(w, 0);
            repsByWeek.put(w, 0);
            holdSecondsByWeek.put(w, 0);
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
            holdSecondsByWeek.merge(weekStart, sessionHoldSeconds.getOrDefault(entry.getKey(), 0), Integer::sum);
        }

        List<WeeklyPointDto> weeklyPoints = workoutCountByWeek.entrySet().stream()
                .map(e -> new WeeklyPointDto(e.getKey(), e.getValue(),
                        volumeByWeek.get(e.getKey()).setScale(1, RoundingMode.HALF_UP),
                        setsByWeek.get(e.getKey()), repsByWeek.get(e.getKey()),
                        holdSecondsByWeek.get(e.getKey())))
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
                hasAnyHistory);
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

    @Transactional(readOnly = true)
    public List<ExerciseTrendPointDto> getExerciseTrend(Long accountId, Long personId, Long exerciseId, int weeks, String zone) {
        Person person = personService.requireOwnedPerson(personId, accountId);
        int effectiveWeeks = Math.min(Math.max(weeks, 1), MAX_WEEKS);
        ZoneId zoneId = resolveZone(zone);

        LocalDate today = LocalDate.ofInstant(clock.instant(), zoneId);
        LocalDate rangeStart = today.with(DayOfWeek.MONDAY).minusWeeks(effectiveWeeks - 1L);

        // The Free-tier window pulls rangeStart FORWARD -- it clamps the range, deliberately not
        // the set list. Filtering the list instead would starve the running-best seeding below of
        // everything older than the window, so a Free household's lesser set would be re-flagged
        // as a PR on the chart. Same rule as getPrList: detection reads the whole history, only
        // what is DISPLAYED is clamped. Telling someone they set a record they did not set is
        // worse than withholding one.
        Instant floor = subscriptionService.historyFloor(accountId);
        if (floor != null) {
            LocalDate floorDate = LocalDate.ofInstant(floor, zoneId);
            if (floorDate.isAfter(rangeStart)) rangeStart = floorDate;
        }

        List<WorkoutSet> all = workoutSetRepository.findByPerson_IdAndExercise_Id(person.getId(), exerciseId);

        // Seed the running best from everything before the window so a PR from outside the
        // requested range isn't wrongly re-flagged as new once it scrolls into view.
        BigDecimal runningBestLb = BigDecimal.ZERO;
        Map<Long, List<WorkoutSet>> sessionsInWindow = new LinkedHashMap<>();
        for (WorkoutSet s : all) {
            LocalDate date = LocalDate.ofInstant(s.getSession().getStartedAt(), zoneId);
            if (date.isBefore(rangeStart)) {
                BigDecimal estLb = comparableValue(s.getWeight(), s.getReps(), s.getDurationSeconds(), s.getUnit());
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
            BigDecimal est1rmLb = comparableValue(best.getWeight(), best.getReps(), best.getDurationSeconds(),
                    best.getUnit());
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
            Integer bestHoldSeconds = null;
            int totalHoldSeconds = 0;
            for (WorkoutSet s : sessionSets) {
                if (s.getDurationSeconds() != null) {
                    totalHoldSeconds += s.getDurationSeconds();
                    if (bestHoldSeconds == null || s.getDurationSeconds() > bestHoldSeconds) {
                        bestHoldSeconds = s.getDurationSeconds();
                    }
                }
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
                    totalReps, sessionSets.size(),
                    bestHoldSeconds, totalHoldSeconds));
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
        List<WorkoutSet> all = visibleTo(accountId,
                workoutSetRepository.findByPerson_IdAndExercise_Id(person.getId(), exerciseId));
        if (all.isEmpty()) {
            return new ExerciseRecordsDto(null, null, null, null, null, null, null, 0, 0, 0,
                    BigDecimal.ZERO.setScale(1, RoundingMode.HALF_UP), false, false);
        }

        WorkoutSet heaviest = null;
        WorkoutSet bestEst1rm = null;
        BigDecimal bestEst1rmLb = null;
        WorkoutSet bestSetVolume = null;
        WorkoutSet mostReps = null;
        WorkoutSet longestHold = null;
        WorkoutSet heaviestLoadHeld = null;
        int totalReps = 0;
        int totalHoldSeconds = 0;
        BigDecimal totalVolumeLb = BigDecimal.ZERO;
        boolean bodyweightOnly = true;
        // Every set of one exercise shares that exercise's measure, so this is a property of the
        // exercise read off the data rather than a per-set mix.
        boolean durationTracked = all.get(0).getExercise().isDurationTracked();
        Map<Long, BigDecimal> volumeBySession = new LinkedHashMap<>();
        Map<Long, WorkoutSet> anySetInSession = new LinkedHashMap<>();

        for (WorkoutSet s : all) {
            BigDecimal weightLb = unitConverter.toLb(s.getWeight(), s.getUnit());
            BigDecimal setVolumeLb = weightLb.multiply(BigDecimal.valueOf(s.getReps()));

            // Heaviest weight, more reps as the tiebreak.
            if (heaviest == null || isBetter(weightLb, reps(s), lbWeight(heaviest), reps(heaviest))) {
                heaviest = s;
            }
            // Deliberately NOT the same thing as `heaviest`: Epley rewards reps, so 185x8 (~234)
            // outranks a 225x1 single. Bodyweight sets are skipped rather than run through
            // comparableLb -- a rep count competing against pounds would win on any set past ~1
            // rep for a lightly-loaded lift. Ties go to the heavier actual load, since Epley
            // extrapolates further (and less reliably) the more reps you feed it.
            if (s.getWeight().compareTo(BigDecimal.ZERO) != 0) {
                BigDecimal est1rmLb = unitConverter.toLb(
                        epleyCalculator.estimate1RM(s.getWeight(), s.getReps()), s.getUnit());
                if (bestEst1rm == null || isBetter(est1rmLb, weightLb, bestEst1rmLb, lbWeight(bestEst1rm))) {
                    bestEst1rm = s;
                    bestEst1rmLb = est1rmLb;
                }
            }
            if (bestSetVolume == null || setVolumeLb.compareTo(setVolumeLb(bestSetVolume)) > 0) {
                bestSetVolume = s;
            }
            // The mirror of `heaviest`: most reps, heavier weight as the tiebreak.
            if (mostReps == null || isBetter(reps(s), weightLb, reps(mostReps), lbWeight(mostReps))) {
                mostReps = s;
            }

            // The two records that carry the signal for a hold. Longest hold ranks on seconds
            // alone; heaviest load held is the separate record that keeps added load visible
            // without inventing a load-adjusted score for it -- see comparableValue.
            if (s.getDurationSeconds() != null) {
                totalHoldSeconds += s.getDurationSeconds();
                if (longestHold == null || isBetter(BigDecimal.valueOf(s.getDurationSeconds()), weightLb,
                        BigDecimal.valueOf(longestHold.getDurationSeconds()), lbWeight(longestHold))) {
                    longestHold = s;
                }
                if (heaviestLoadHeld == null || isBetter(weightLb, BigDecimal.valueOf(s.getDurationSeconds()),
                        lbWeight(heaviestLoadHeld), BigDecimal.valueOf(heaviestLoadHeld.getDurationSeconds()))) {
                    heaviestLoadHeld = s;
                }
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

        // A hold has no meaningful est. 1RM and no meaningful rep record -- a column of zeros is
        // worse than no column, the same call bodyweightOnly already makes for weight-based rows.
        return new ExerciseRecordsDto(
                bestEst1rm == null || durationTracked ? null : toRecordEntry(bestEst1rmLb, bestEst1rm, zoneId),
                toRecordEntry(lbWeight(heaviest), heaviest, zoneId),
                toRecordEntry(setVolumeLb(bestSetVolume), bestSetVolume, zoneId),
                new RecordEntryDto(bestSession.getValue().setScale(1, RoundingMode.HALF_UP), null, null, null,
                        sessionDate(anySetInSession.get(bestSession.getKey()), zoneId)),
                durationTracked ? null : toRecordEntry(BigDecimal.valueOf(mostReps.getReps()), mostReps, zoneId),
                longestHold == null ? null
                        : toRecordEntry(BigDecimal.valueOf(longestHold.getDurationSeconds()), longestHold, zoneId),
                heaviestLoadHeld == null ? null
                        : toRecordEntry(lbWeight(heaviestLoadHeld), heaviestLoadHeld, zoneId),
                all.size(),
                totalReps,
                totalHoldSeconds,
                totalVolumeLb.setScale(1, RoundingMode.HALF_UP),
                bodyweightOnly,
                durationTracked);
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
                lbWeight(set).setScale(1, RoundingMode.HALF_UP), set.getReps(), set.getDurationSeconds(),
                sessionDate(set, zoneId));
    }
}
