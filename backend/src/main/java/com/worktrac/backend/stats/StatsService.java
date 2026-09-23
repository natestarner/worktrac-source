package com.worktrac.backend.stats;

import com.worktrac.backend.billing.SubscriptionService;
import com.worktrac.backend.exercise.Exercise;
import com.worktrac.backend.membership.AccountAccess;
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
import java.util.Set;
import java.util.TreeMap;
import java.util.stream.Collectors;

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
    private final SubscriptionService subscriptionService;
    // The set-level measures (est.-1RM ranking, top weight) and the session-level one (volume) each
    // have ONE definition, shared with the client through shared/record-rules/. Nothing in this
    // class re-derives them -- see SetMeasures and SessionVolume.
    private final SetMeasures setMeasures;
    private final SessionVolume sessionVolume;
    private final Clock clock;

    public StatsService(WorkoutSetRepository workoutSetRepository, SessionExerciseNoteRepository sessionExerciseNoteRepository,
                         PersonService personService, EpleyCalculator epleyCalculator,
                         SubscriptionService subscriptionService, SetMeasures setMeasures, SessionVolume sessionVolume,
                         Clock clock) {
        this.workoutSetRepository = workoutSetRepository;
        this.sessionExerciseNoteRepository = sessionExerciseNoteRepository;
        this.personService = personService;
        this.epleyCalculator = epleyCalculator;
        this.subscriptionService = subscriptionService;
        this.setMeasures = setMeasures;
        this.sessionVolume = sessionVolume;
        this.clock = clock;
    }

    @Transactional(readOnly = true)
    public ExerciseSummaryDto getSummary(AccountAccess access, Long personId, Long exerciseId, Long excludeSessionId) {
        Person person = personService.requireVisiblePerson(personId, access);
        // ONE load for all four fields. getLastSession and getBest each used to issue their own
        // findByPerson_IdAndExercise_Id; folding the two new measures into a single shared pass
        // means this endpoint now makes FEWER queries than before, not more. See
        // .claude/rules/trends.md: "a new metric folds into one of those passes -- it does not add
        // a fifth findByPerson_Id... call."
        List<WorkoutSet> all = workoutSetRepository.findByPerson_IdAndExercise_Id(person.getId(), exerciseId);

        LastSessionDto lastSession = buildLastSession(all, exerciseId, excludeSessionId).orElse(null);
        BestDto best = bestSet(all).map(this::toBestDto).orElse(null);

        // ⚠️ Deliberately asymmetric exclusion -- see ExerciseSummaryDto's header for the full
        // reasoning. heaviestWeightLb is all-time INCLUDING today (a set PR beats everything
        // before it, and earlier sets today are before it); bestSessionVolume EXCLUDES the
        // session in view, or the record chases itself and re-fires on every subsequent set.
        //
        // The volume KIND, though, is decided over every set including today's: it is a property
        // of the exercise, and the client merges it with the sets it holds that have not synced.
        SessionVolume.Kind volumeKind = all.isEmpty() ? null
                : sessionVolume.kindOf(all.get(0).getExercise().isDurationTracked(), all);
        BigDecimal heaviestWeightLb = null;
        Map<Long, BigDecimal> volumeByOtherSession = new LinkedHashMap<>();
        Map<Long, BigDecimal> loadVolumeByOtherSession = new LinkedHashMap<>();
        for (WorkoutSet s : all) {
            BigDecimal weightLb = setMeasures.weightLb(s);
            if (heaviestWeightLb == null || weightLb.compareTo(heaviestWeightLb) > 0) {
                heaviestWeightLb = weightLb;
            }
            Long sessionId = s.getSession().getId();
            if (excludeSessionId != null && sessionId.equals(excludeSessionId)) {
                continue;
            }
            volumeByOtherSession.merge(sessionId, sessionVolume.setVolume(s, volumeKind), BigDecimal::add);
            loadVolumeByOtherSession.merge(sessionId, sessionVolume.loadVolumeLb(s), BigDecimal::add);
        }
        BigDecimal bestSessionVolume = volumeByOtherSession.values().stream()
                .max(BigDecimal::compareTo)
                .orElse(null);
        BigDecimal legacyBestSessionVolumeLb = loadVolumeByOtherSession.values().stream()
                .max(BigDecimal::compareTo)
                .orElse(null);

        // heaviestWeightLb and bestSessionVolume go out UNROUNDED: they are thresholds the client
        // compares its own unrounded figures against (a 100 kg set is 220.462 lb on both sides).
        // Rounding them to 0.1 made the online answer differ from the offline fallback, which
        // derives the same thresholds from history without rounding -- a 220.46 lb best, sent as
        // 220.5, hid a 100 kg top-weight record online that the offline path correctly found.
        return new ExerciseSummaryDto(lastSession, best, heaviestWeightLb,
                bestSessionVolume, volumeKind == null ? null : volumeKind.wire(),
                scaled(legacyBestSessionVolumeLb));
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
        return buildLastSession(workoutSetRepository.findByPerson_IdAndExercise_Id(personId, exerciseId),
                exerciseId, excludeSessionId);
    }

    // The body of getLastSession, over a set list the caller has already loaded, so getSummary can
    // share one load across all four of its fields.
    private Optional<LastSessionDto> buildLastSession(List<WorkoutSet> all, Long exerciseId, Long excludeSessionId) {
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
    public List<PrRowDto> getPrList(AccountAccess access, Long personId) {
        Person person = personService.requireVisiblePerson(personId, access);
        List<WorkoutSet> all = workoutSetRepository.findByPerson_IdOrderByCreatedAtAscIdAsc(person.getId());

        // The Free-tier window, applied to what is DISPLAYED. Note this is deliberately NOT applied
        // to getBestComparableValue below, which is what WorkoutSetService asks when deciding
        // whether a new set is a PR: detection reads the person's whole history, so a Free
        // household is never congratulated for beating a 90-day best that is not their real best.
        // Telling someone they set a record they did not set is worse than withholding one.
        Instant floor = subscriptionService.historyFloor(access.accountId());

        Map<Long, List<WorkoutSet>> byExercise = new LinkedHashMap<>();
        for (WorkoutSet s : all) {
            if (!SubscriptionService.isVisible(floor, s.getSession().getStartedAt())) continue;
            byExercise.computeIfAbsent(s.getExercise().getId(), k -> new java.util.ArrayList<>()).add(s);
        }

        return byExercise.values().stream()
                .map(sets -> {
                    Exercise exercise = sets.get(0).getExercise();
                    WorkoutSet best = bestSet(sets).orElseThrow();
                    // durationTracked is a property of the exercise (every set of one exercise
                    // shares its measure); bodyweightOnly is "nothing here was ever loaded". The
                    // same two derivations getExerciseRecords makes, deciding the same thing:
                    // which measures must be ABSENT rather than zero.
                    boolean durationTracked = exercise.isDurationTracked();
                    boolean bodyweightOnly = sets.stream()
                            .allMatch(s -> s.getWeight().compareTo(BigDecimal.ZERO) == 0);
                    SessionVolume.Kind volumeKind = sessionVolume.kindOf(durationTracked, sets);
                    return new PrRowDto(exercise.getId(), exercise.getName(), toBestDto(best),
                            buildPrMeasures(sets, bodyweightOnly, durationTracked, volumeKind),
                            bodyweightOnly, durationTracked, volumeKind.wire());
                })
                .sorted(Comparator.comparing(PrRowDto::exerciseName, String.CASE_INSENSITIVE_ORDER))
                .toList();
    }

    // The four measures the PRs board can rank by besides est. 1RM, computed in one pass over sets
    // getPrList has ALREADY loaded and grouped. .claude/rules/trends.md: a new metric folds into an
    // existing pass or gets a SQL aggregate -- it does not add another findByPerson_Id... call, and
    // this one adds no query at all.
    //
    // The maths mirrors getExerciseRecords' heaviestWeight / bestSetVolume / bestSessionVolume
    // rather than inventing new comparators. One deliberate difference: totalReps here is the best
    // SESSION rep total, matching EXERCISE_METRICS.totalReps on the chart, NOT getExerciseRecords'
    // most-reps-in-a-SET. The board and the chart have to mean the same thing by "Reps" -- the
    // record picker and the metric switcher are the same five words on two screens.
    private PrMeasuresDto buildPrMeasures(List<WorkoutSet> sets, boolean bodyweightOnly,
                                          boolean durationTracked, SessionVolume.Kind volumeKind) {
        // Best-set volume and the rep total are weight x reps or reps, so a hold (reps always 0)
        // collapses both to zero exactly as a never-loaded exercise collapses best-set volume.
        // Absent beats a column of zeros -- see PrMeasuresDto. Session volume is the exception: it
        // is measured in the exercise's own unit (SessionVolume), so every exercise has one.
        boolean noVolumeMeasure = bodyweightOnly || durationTracked;

        WorkoutSet heaviest = null;
        WorkoutSet bestSetVolume = null;
        Map<Long, BigDecimal> volumeBySession = new LinkedHashMap<>();
        Map<Long, Integer> repsBySession = new LinkedHashMap<>();
        Map<Long, WorkoutSet> anySetInSession = new LinkedHashMap<>();
        // Every set of every session, kept so a session-level record can name the work behind it.
        // Free here -- these are rows getPrList has already loaded and grouped; nothing is queried.
        Map<Long, List<WorkoutSet>> setsBySession = new LinkedHashMap<>();

        for (WorkoutSet s : sets) {
            if (heaviest == null || isBetter(setMeasures.weightLb(s), reps(s), setMeasures.weightLb(heaviest), reps(heaviest))) {
                heaviest = s;
            }
            if (bestSetVolume == null || setVolumeLb(s).compareTo(setVolumeLb(bestSetVolume)) > 0) {
                bestSetVolume = s;
            }
            Long sessionId = s.getSession().getId();
            volumeBySession.merge(sessionId, sessionVolume.setVolume(s, volumeKind), BigDecimal::add);
            repsBySession.merge(sessionId, s.getReps(), Integer::sum);
            anySetInSession.putIfAbsent(sessionId, s);
            setsBySession.computeIfAbsent(sessionId, k -> new ArrayList<>()).add(s);
        }

        return new PrMeasuresDto(
                bodyweightOnly ? null : setMeasure(setMeasures.weightLb(heaviest), heaviest),
                sessionMeasure(volumeBySession, anySetInSession, setsBySession),
                noVolumeMeasure ? null : setMeasure(setVolumeLb(bestSetVolume), bestSetVolume),
                durationTracked ? null : sessionRepMeasure(repsBySession, anySetInSession, setsBySession));
    }

    // How many collapsed runs a session-level record's breakdown may carry. A cap rather than the
    // whole session because this rides on the PRs board -- one row per exercise -- which
    // offlineCacheWarm persists to IndexedDB. setCount still reports the true total, so a
    // truncated list can be labelled honestly instead of understating the work.
    //
    // Raised 6 -> 10 when the client's own tighter cap of 3 was removed. That cap existed because
    // the breakdown shared a narrow right-hand column with a value and a chevron, and its "+N more"
    // tail pointed at sets there was no way to reach -- the row is one button that opens a
    // destination chooser, so the tail was not tappable. The caption now takes a full-width line
    // and shows everything sent, which makes THIS the only cap left, and 6 truncated real sessions.
    // Runs are collapsed ("3x155x8" is one run), so 10 covers essentially any real workout while
    // still bounding the cached blob.
    private static final int MAX_PR_BREAKDOWN_RUNS = 10;

    // The work behind a session-level record, with consecutive identical sets collapsed into runs.
    // Chronological (createdAt) so it reads the way the workout was actually done, ramping and all.
    private List<PrSetDto> breakdown(List<WorkoutSet> sessionSets) {
        List<PrSetDto> runs = new ArrayList<>();
        for (WorkoutSet s : sessionSets.stream().sorted(Comparator.comparing(WorkoutSet::getCreatedAt)).toList()) {
            BigDecimal weightLb = setMeasures.weightLb(s).setScale(1, RoundingMode.HALF_UP);
            PrSetDto last = runs.isEmpty() ? null : runs.get(runs.size() - 1);
            boolean sameAsLast = last != null
                    && last.weightLb().compareTo(weightLb) == 0
                    && last.reps() == s.getReps()
                    && java.util.Objects.equals(last.durationSeconds(), s.getDurationSeconds());
            if (sameAsLast) {
                runs.set(runs.size() - 1, new PrSetDto(last.weightLb(), last.reps(), last.durationSeconds(),
                        last.count() + 1));
            } else {
                if (runs.size() >= MAX_PR_BREAKDOWN_RUNS) {
                    // Stop adding NEW runs, but keep folding into the last one -- truncating
                    // mid-run would report a count smaller than the run really was.
                    continue;
                }
                runs.add(new PrSetDto(weightLb, s.getReps(), s.getDurationSeconds(), 1));
            }
        }
        return runs;
    }

    // A set-level measure names the set behind it, the way the est.-1RM records row must -- a
    // number larger than anything you actually lifted reads as a bug without it.
    private PrMeasureDto setMeasure(BigDecimal value, WorkoutSet set) {
        // No breakdown: a set-level measure already names its own set through weightLb/reps.
        return new PrMeasureDto(value.setScale(1, RoundingMode.HALF_UP),
                setMeasures.weightLb(set).setScale(1, RoundingMode.HALF_UP), set.getReps(),
                set.getSession().getStartedAt(), List.of(), 0);
    }

    // A session-level measure carries no single set: weightLb/reps stay null because no one set is
    // the answer, the same shape bestSessionVolume has on RecordEntryDto. What it DOES carry is
    // the whole session's work, collapsed into runs -- see PrSetDto for why.
    private PrMeasureDto sessionMeasure(Map<Long, BigDecimal> valueBySession,
                                        Map<Long, WorkoutSet> anySetInSession,
                                        Map<Long, List<WorkoutSet>> setsBySession) {
        Map.Entry<Long, BigDecimal> best = valueBySession.entrySet().stream()
                .max(Map.Entry.comparingByValue())
                .orElseThrow();
        List<WorkoutSet> sessionSets = setsBySession.getOrDefault(best.getKey(), List.of());
        return new PrMeasureDto(best.getValue().setScale(1, RoundingMode.HALF_UP), null, null,
                anySetInSession.get(best.getKey()).getSession().getStartedAt(),
                breakdown(sessionSets), sessionSets.size());
    }

    private PrMeasureDto sessionRepMeasure(Map<Long, Integer> repsBySession,
                                           Map<Long, WorkoutSet> anySetInSession,
                                           Map<Long, List<WorkoutSet>> setsBySession) {
        Map.Entry<Long, Integer> best = repsBySession.entrySet().stream()
                .max(Map.Entry.comparingByValue())
                .orElseThrow();
        List<WorkoutSet> sessionSets = setsBySession.getOrDefault(best.getKey(), List.of());
        return new PrMeasureDto(BigDecimal.valueOf(best.getValue()), null, null,
                anySetInSession.get(best.getKey()).getSession().getStartedAt(),
                breakdown(sessionSets), sessionSets.size());
    }

    private Optional<WorkoutSet> bestSet(List<WorkoutSet> sets) {
        WorkoutSet best = null;
        BigDecimal bestComparable = null;
        for (WorkoutSet s : sets) {
            BigDecimal comparable = setMeasures.comparableValue(s);
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
                .map(setMeasures::comparableValue);
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
    public TrendsOverviewDto getOverview(AccountAccess access, Long personId, int weeks, String zone) {
        Person person = personService.requireVisiblePerson(personId, access);
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

        List<WorkoutSet> all = visibleTo(access.accountId(), loaded);

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
            // Weight x reps, deliberately NOT SessionVolume's per-exercise measure: this sums across
            // exercises, and pounds cannot be added to reps or seconds.
            sessionVolumeLb.merge(sessionId, sessionVolume.loadVolumeLb(s), BigDecimal::add);
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

        // Shared with the trainer roster (WeeklyStreak), so the number a client sees on Trends and
        // the number their trainer sees on the roster cannot disagree. The current-week-in-progress
        // rule lives there.
        Set<LocalDate> weeksTrained = workoutCountByWeek.entrySet().stream()
                .filter(e -> e.getValue() > 0)
                .map(Map.Entry::getKey)
                .collect(Collectors.toSet());
        int currentStreakWeeks = WeeklyStreak.consecutiveWeeks(weeksTrained, currentWeekStart, rangeStart);

        LocalDate thisWindowStart = today.minusDays(29);
        LocalDate lastWindowStart = today.minusDays(59);
        LocalDate lastWindowEnd = today.minusDays(30);
        BigDecimal volumeThisMonthLb = BigDecimal.ZERO;
        BigDecimal volumeLastMonthLb = BigDecimal.ZERO;
        for (WorkoutSet s : all) {
            LocalDate date = sessionDate.get(s.getSession().getId());
            if (!date.isBefore(thisWindowStart) && !date.isAfter(today)) {
                volumeThisMonthLb = volumeThisMonthLb.add(sessionVolume.loadVolumeLb(s));
            } else if (!date.isBefore(lastWindowStart) && !date.isAfter(lastWindowEnd)) {
                volumeLastMonthLb = volumeLastMonthLb.add(sessionVolume.loadVolumeLb(s));
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
    public List<ExerciseTrendPointDto> getExerciseTrend(AccountAccess access, Long personId, Long exerciseId, int weeks, String zone) {
        Person person = personService.requireVisiblePerson(personId, access);
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
        Instant floor = subscriptionService.historyFloor(access.accountId());
        if (floor != null) {
            LocalDate floorDate = LocalDate.ofInstant(floor, zoneId);
            if (floorDate.isAfter(rangeStart)) rangeStart = floorDate;
        }

        List<WorkoutSet> all = workoutSetRepository.findByPerson_IdAndExercise_Id(person.getId(), exerciseId);
        // Decided over the VISIBLE sets, like getExerciseRecords' and getPrList's, so the chart's
        // "Volume" line is in the same unit as the records table under it and the board's row.
        // (Falls back to every set only in the sliver where the window's DATE admits a session its
        // INSTANT does not -- a point is still plotted there, so it still needs a kind.)
        List<WorkoutSet> visible = visibleTo(access.accountId(), all);
        SessionVolume.Kind volumeKind = all.isEmpty() ? null
                : sessionVolume.kindOf(all.get(0).getExercise().isDurationTracked(), visible.isEmpty() ? all : visible);

        // Seed the running best from everything before the window so a PR from outside the
        // requested range isn't wrongly re-flagged as new once it scrolls into view.
        BigDecimal runningBestLb = BigDecimal.ZERO;
        Map<Long, List<WorkoutSet>> sessionsInWindow = new LinkedHashMap<>();
        for (WorkoutSet s : all) {
            LocalDate date = LocalDate.ofInstant(s.getSession().getStartedAt(), zoneId);
            if (date.isBefore(rangeStart)) {
                BigDecimal estLb = setMeasures.comparableValue(s);
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
            BigDecimal weightLb = setMeasures.weightLb(best);
            BigDecimal est1rmLb = setMeasures.comparableValue(best);
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
            BigDecimal sessionVolumeTotal = sessionVolume.sessionVolume(sessionSets, volumeKind);
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
                BigDecimal setWeightLb = setMeasures.weightLb(s);
                // Ties broken by reps so an all-bodyweight session reports its best rep set rather
                // than whichever 0-weight set happened to come first.
                int weightComparison = heaviestWeightLb == null ? 1 : setWeightLb.compareTo(heaviestWeightLb);
                if (weightComparison > 0 || (weightComparison == 0 && s.getReps() > heaviestWeightReps)) {
                    heaviestWeightLb = setWeightLb;
                    heaviestWeightReps = s.getReps();
                }
                BigDecimal setVolumeLb = sessionVolume.loadVolumeLb(s);
                if (setVolumeLb.compareTo(bestSetVolumeLb) > 0) {
                    bestSetVolumeLb = setVolumeLb;
                }
                totalReps += s.getReps();
            }

            LocalDate date = LocalDate.ofInstant(best.getSession().getStartedAt(), zoneId);
            points.add(new ExerciseTrendPointDto(date, best.getSession().getId(),
                    weightLb.setScale(1, RoundingMode.HALF_UP), best.getReps(),
                    est1rmLb.setScale(1, RoundingMode.HALF_UP), isPr,
                    heaviestWeightLb.setScale(1, RoundingMode.HALF_UP), heaviestWeightReps,
                    bestSetVolumeLb.setScale(1, RoundingMode.HALF_UP),
                    sessionVolumeTotal.setScale(1, RoundingMode.HALF_UP), volumeKind.wire(),
                    totalReps, sessionSets.size(),
                    bestHoldSeconds, totalHoldSeconds));
        }
        return points;
    }

    // All-time records for one exercise, deliberately not range-scoped -- see ExerciseRecordsDto.
    // One pass over the same per-exercise query getBest/getExerciseTrend already use; no new
    // repository method and no second full-history load.
    @Transactional(readOnly = true)
    public ExerciseRecordsDto getExerciseRecords(AccountAccess access, Long personId, Long exerciseId, String zone) {
        Person person = personService.requireVisiblePerson(personId, access);
        ZoneId zoneId = resolveZone(zone);
        List<WorkoutSet> all = visibleTo(access.accountId(),
                workoutSetRepository.findByPerson_IdAndExercise_Id(person.getId(), exerciseId));
        if (all.isEmpty()) {
            return new ExerciseRecordsDto(null, null, null, null, null, null, null, 0, 0, 0,
                    BigDecimal.ZERO.setScale(1, RoundingMode.HALF_UP), false, false, null);
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
        SessionVolume.Kind volumeKind = sessionVolume.kindOf(durationTracked, all);
        Map<Long, BigDecimal> volumeBySession = new LinkedHashMap<>();
        Map<Long, WorkoutSet> anySetInSession = new LinkedHashMap<>();

        for (WorkoutSet s : all) {
            BigDecimal weightLb = setMeasures.weightLb(s);
            BigDecimal setVolumeLb = sessionVolume.loadVolumeLb(s);

            // Heaviest weight, more reps as the tiebreak.
            if (heaviest == null || isBetter(weightLb, reps(s), setMeasures.weightLb(heaviest), reps(heaviest))) {
                heaviest = s;
            }
            // Deliberately NOT the same thing as `heaviest`: Epley rewards reps, so 185x8 (~234)
            // outranks a 225x1 single. Bodyweight sets are skipped rather than run through
            // comparableLb -- a rep count competing against pounds would win on any set past ~1
            // rep for a lightly-loaded lift. Ties go to the heavier actual load, since Epley
            // extrapolates further (and less reliably) the more reps you feed it.
            if (s.getWeight().compareTo(BigDecimal.ZERO) != 0) {
                // At weight != 0 this IS the Epley estimate in pounds (SetMeasures#comparableLb).
                BigDecimal est1rmLb = setMeasures.comparableLb(s.getWeight(), s.getReps(), s.getUnit());
                if (bestEst1rm == null || isBetter(est1rmLb, weightLb, bestEst1rmLb, setMeasures.weightLb(bestEst1rm))) {
                    bestEst1rm = s;
                    bestEst1rmLb = est1rmLb;
                }
            }
            if (bestSetVolume == null || setVolumeLb.compareTo(setVolumeLb(bestSetVolume)) > 0) {
                bestSetVolume = s;
            }
            // The mirror of `heaviest`: most reps, heavier weight as the tiebreak.
            if (mostReps == null || isBetter(reps(s), weightLb, reps(mostReps), setMeasures.weightLb(mostReps))) {
                mostReps = s;
            }

            // The two records that carry the signal for a hold. Longest hold ranks on seconds
            // alone; heaviest load held is the separate record that keeps added load visible
            // without inventing a load-adjusted score for it -- see comparableValue.
            if (s.getDurationSeconds() != null) {
                totalHoldSeconds += s.getDurationSeconds();
                if (longestHold == null || isBetter(BigDecimal.valueOf(s.getDurationSeconds()), weightLb,
                        BigDecimal.valueOf(longestHold.getDurationSeconds()), setMeasures.weightLb(longestHold))) {
                    longestHold = s;
                }
                if (heaviestLoadHeld == null || isBetter(weightLb, BigDecimal.valueOf(s.getDurationSeconds()),
                        setMeasures.weightLb(heaviestLoadHeld), BigDecimal.valueOf(heaviestLoadHeld.getDurationSeconds()))) {
                    heaviestLoadHeld = s;
                }
            }

            totalReps += s.getReps();
            totalVolumeLb = totalVolumeLb.add(setVolumeLb);
            if (s.getWeight().compareTo(BigDecimal.ZERO) != 0) {
                bodyweightOnly = false;
            }
            volumeBySession.merge(s.getSession().getId(), sessionVolume.setVolume(s, volumeKind), BigDecimal::add);
            anySetInSession.putIfAbsent(s.getSession().getId(), s);
        }

        Map.Entry<Long, BigDecimal> bestSession = volumeBySession.entrySet().stream()
                .max(Map.Entry.comparingByValue())
                .orElseThrow();

        // A hold has no meaningful est. 1RM and no meaningful rep record -- a column of zeros is
        // worse than no column, the same call bodyweightOnly already makes for weight-based rows.
        return new ExerciseRecordsDto(
                bestEst1rm == null || durationTracked ? null : toRecordEntry(bestEst1rmLb, bestEst1rm, zoneId),
                toRecordEntry(setMeasures.weightLb(heaviest), heaviest, zoneId),
                toRecordEntry(setVolumeLb(bestSetVolume), bestSetVolume, zoneId),
                new RecordEntryDto(bestSession.getValue().setScale(1, RoundingMode.HALF_UP), null, null, null,
                        sessionDate(anySetInSession.get(bestSession.getKey()), zoneId)),
                durationTracked ? null : toRecordEntry(BigDecimal.valueOf(mostReps.getReps()), mostReps, zoneId),
                longestHold == null ? null
                        : toRecordEntry(BigDecimal.valueOf(longestHold.getDurationSeconds()), longestHold, zoneId),
                heaviestLoadHeld == null ? null
                        : toRecordEntry(setMeasures.weightLb(heaviestLoadHeld), heaviestLoadHeld, zoneId),
                all.size(),
                totalReps,
                totalHoldSeconds,
                totalVolumeLb.setScale(1, RoundingMode.HALF_UP),
                bodyweightOnly,
                durationTracked,
                volumeKind.wire());
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

    private BigDecimal setVolumeLb(WorkoutSet set) {
        return sessionVolume.loadVolumeLb(set);
    }

    private static BigDecimal scaled(BigDecimal value) {
        return value == null ? null : value.setScale(1, RoundingMode.HALF_UP);
    }

    private LocalDate sessionDate(WorkoutSet set, ZoneId zoneId) {
        return LocalDate.ofInstant(set.getSession().getStartedAt(), zoneId);
    }

    private RecordEntryDto toRecordEntry(BigDecimal valueLb, WorkoutSet set, ZoneId zoneId) {
        return new RecordEntryDto(valueLb.setScale(1, RoundingMode.HALF_UP),
                setMeasures.weightLb(set).setScale(1, RoundingMode.HALF_UP), set.getReps(), set.getDurationSeconds(),
                sessionDate(set, zoneId));
    }
}
