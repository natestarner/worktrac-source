package com.worktrac.backend.workoutsession;

import com.worktrac.backend.billing.SubscriptionService;
import com.worktrac.backend.common.NotFoundException;
import com.worktrac.backend.common.ServiceUnavailableException;
import com.worktrac.backend.membership.AccountAccess;
import com.worktrac.backend.person.Person;
import com.worktrac.backend.person.PersonService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.YearMonth;
import java.time.ZoneOffset;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.TreeSet;

@Service
public class WorkoutSessionService {

    private static final Logger log = LoggerFactory.getLogger(WorkoutSessionService.class);

    // A session is treated as over if its last logged set was more than 8 hours ago --
    // measured from last_activity_at, not started_at, so a long-running live session
    // doesn't get incorrectly auto-closed mid-workout.
    static final Duration AUTOCLOSE = Duration.ofHours(8);

    private final WorkoutSessionRepository workoutSessionRepository;
    private final HistoryMonths historyMonths;
    private final HistoryFingerprints historyFingerprints;
    private final PersonService personService;
    private final SubscriptionService subscriptionService;
    private final Clock clock;

    public WorkoutSessionService(WorkoutSessionRepository workoutSessionRepository, HistoryMonths historyMonths,
                                  HistoryFingerprints historyFingerprints, PersonService personService,
                                  SubscriptionService subscriptionService, Clock clock) {
        this.workoutSessionRepository = workoutSessionRepository;
        this.historyMonths = historyMonths;
        this.historyFingerprints = historyFingerprints;
        this.personService = personService;
        this.subscriptionService = subscriptionService;
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
    // starts a brand new session if none exists. No client timestamp available here --
    // falls back to the server clock, matching every caller before offline replay
    // needed to honor an original client-side start time.
    @Transactional
    public WorkoutSession getOrCreateLiveSession(Person person) {
        return getOrCreateLiveSession(person, null);
    }

    // Same as above, but honors clientLoggedAt (when supplied) for a BRAND NEW session's
    // startedAt -- so a set logged offline and replayed later after reconnecting still
    // records when the workout actually started, not when the replay reached the server.
    // Only the new-session branch uses it: lastActivityAt (the reuse branch) only feeds the
    // 8-hour AUTOCLOSE staleness check below, which is read-time-relative and can only ever
    // judge a session MORE stale using now() than clientLoggedAt would, never flip a
    // should-be-closed session into "still live" incorrectly -- so it's left on the server
    // clock. rest_seconds is independent (computed from each set's own createdAt).
    @Transactional
    public WorkoutSession getOrCreateLiveSession(Person person, Instant clientLoggedAt) {
        Optional<WorkoutSession> live = getLiveSession(person);
        Instant now = Instant.now(clock);
        if (live.isPresent()) {
            WorkoutSession session = live.get();
            session.setLastActivityAt(now);
            return session;
        }
        Instant startedAt = clientLoggedAt != null ? clientLoggedAt : now;
        return workoutSessionRepository.save(new WorkoutSession(person, startedAt, false));
    }

    @Transactional(readOnly = true)
    public Optional<WorkoutSessionDto> getLiveSessionDto(AccountAccess access, Long personId) {
        Person person = personService.requireVisiblePerson(personId, access);
        return getLiveSession(person).map(WorkoutSessionDto::from);
    }

    @Transactional
    public void endWorkout(AccountAccess access, Long personId) {
        Person person = personService.requireWritablePerson(personId, access);
        getLiveSession(person).ifPresent(session -> session.setEndedAt(Instant.now(clock)));
    }

    @Transactional
    public WorkoutSessionDto createPastSession(AccountAccess access, Long personId, Instant startedAt) {
        Person person = personService.requireWritablePerson(personId, access);
        WorkoutSession session = new WorkoutSession(person, startedAt, true);
        session.setEndedAt(startedAt); // point-in-time marker until sets are logged into it
        return WorkoutSessionDto.from(workoutSessionRepository.save(session));
    }

    // No personId in this endpoint's path -- ownership is enforced purely via
    // session -> person -> account, since there is no client-supplied personId to
    // cross-check against at all here.
    @Transactional
    public WorkoutSessionDto editSession(AccountAccess access, Long sessionId, Instant newStartedAt) {
        WorkoutSession session = workoutSessionRepository.findByIdAndPerson_Account_Id(sessionId, access.accountId())
                .orElseThrow(() -> new NotFoundException("We couldn't find that workout."));
        // Child-id endpoint. The finder above proves the session is in this ACCOUNT, which was the
        // entire boundary while an account had exactly one login -- it says nothing about whether
        // the caller may write to the PERSON behind it. Without this, a member could edit a
        // sibling's workout by its id alone, having been correctly refused the personId route.
        // The message stays the session's, not the person's: from here that is what was asked for.
        personService.requireWritablePerson(session.getPerson(), access, "We couldn't find that workout.");

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
    //
    // The app itself reads History through syncHistory below; this is the same builder with every
    // month flattened, kept for API readers and any installed client that predates the sync.
    //
    // The Free-tier window is a READ FILTER and nothing else -- every row stays in the database,
    // which is what makes "nothing is deleted, ever" true and makes re-subscribing restore the full
    // history in a single round trip.
    @Transactional(readOnly = true)
    public List<HistorySessionDto> getHistory(AccountAccess access, Long personId) {
        Person person = personService.requireVisiblePerson(personId, access);
        Instant floor = subscriptionService.historyFloor(access.accountId());
        return historyMonths.load(person.getId(), floor, null, null).values().stream()
                .flatMap(month -> month.sessions().stream())
                .toList();
    }

    // History, sent a month at a time and only for the months the client does not already hold.
    //
    // `have` is the client's month -> fingerprint map. The reply lists every month the client should
    // end up with, and carries content only for those whose fingerprint differs; a month the client
    // holds that is not listed is gone. Three steps, and the third is what makes the reply safe to
    // trust even while writes land mid-request:
    //
    //   1. Which months differ -- one aggregate query, no month is built (HistoryFingerprints).
    //   2. Load the months spanning those, in ONE statement, each month's fingerprint derived from the
    //      very rows that built it (HistoryMonths), so content and fingerprint can never disagree.
    //   3. Re-check every month the client will KEEP. A write that moved a workout out of a month we
    //      loaded into one we did not would otherwise leave it in neither on the device (or in both).
    //      If any kept month changed, answer 503 and let the client's ordinary query retry ask again
    //      -- deliberately not a retry loop here (backend-core.md: no backend retries).
    //
    // Nothing is loaded at all when nothing differs, which is the common case: a reload, a warm, a
    // refetch after a write on another person.
    @Transactional(readOnly = true)
    public HistorySyncDto syncHistory(AccountAccess access, Long personId, Map<String, String> have) {
        return syncHistory(access, personId, have, null, null);
    }

    @Transactional(readOnly = true)
    public HistorySyncDto syncHistory(AccountAccess access, Long personId, Map<String, String> have,
                                      List<Long> sessions, List<Instant> at) {
        Map<String, String> held = have == null ? Map.of() : have;
        SyncTiming timing = new SyncTiming(personId, held.size());
        Person person = personService.requireVisiblePerson(personId, access);
        Instant floor = subscriptionService.historyFloor(access.accountId());
        timing.prepared();

        // A device holding nothing -- a new device, a fresh sign-in, the daily full sync -- gets every
        // month straight from the load, with no fingerprint query before it and no re-check after.
        // Every month differs from "nothing", so the first query could not change what is loaded;
        // and the re-check exists only to protect months the device KEEPS, of which there are none.
        // What is left is one statement, one snapshot -- exactly GET /history -- and a month created
        // mid-request simply arrives on the next sync instead of refusing this one. Each month's
        // fingerprint comes from its own rows, as it always does for a loaded month.
        if (held.isEmpty()) {
            Map<String, HistoryMonths.Month> all = historyMonths.load(person.getId(), floor, null, null);
            timing.loaded(all.size());
            Map<String, HistoryMonthDto> changed = new LinkedHashMap<>();
            all.forEach((month, m) -> changed.put(month, new HistoryMonthDto(m.fingerprint(), m.sessions())));
            timing.done();
            return new HistorySyncDto(List.copyOf(all.keySet()), changed);
        }

        // A SCOPED sync: after a write on this device, only the months of the workouts it touched. No
        // all-months fingerprint query and no re-check: the scoped months are simply loaded -- one
        // small statement, one snapshot -- and each is sent if its fingerprint (derived from its own
        // rows) differs from the one held. A scoped month with no visible workouts left is not
        // listed, so the device drops it. Every other month the device holds is left alone and is
        // re-verified by the next ordinary sync (app open, refocus, the periodic warm, the daily
        // full sync): a change made ELSEWHERE in another month reaches this device then rather than
        // now. That delay is the accepted cost (docs/architecture/history-sync.md, "Scoped syncs").
        //
        // The scope is every month the device HOLDS a touched workout in (`at`) plus every month those
        // workouts are in NOW (`sessions`, looked up here). They differ when a workout was moved to
        // another date elsewhere: reloading only the held month would drop it from the device, only
        // the current one would show it twice. The months are worked out HERE -- `at` in UTC, the same
        // month CONVERT(CHAR(7), started_at, 126) gives since started_at is stored in UTC, and the
        // current ones by that CONVERT itself. The client never computes one.
        boolean scoped = (at != null && !at.isEmpty()) || (sessions != null && !sessions.isEmpty());
        if (scoped) {
            TreeSet<YearMonth> scope = new TreeSet<>(Comparator.reverseOrder());
            if (at != null) {
                for (Instant instant : at) {
                    scope.add(YearMonth.from(instant.atOffset(ZoneOffset.UTC)));
                }
            }
            if (sessions != null && !sessions.isEmpty()) {
                scope.addAll(historyMonths.monthsOf(person.getId(), sessions));
            }
            Map<String, HistoryMonths.Month> loaded = historyMonths.loadMonths(person.getId(), floor, scope);
            timing.loaded(loaded.size());
            Map<String, HistoryMonthDto> changed = new LinkedHashMap<>();
            loaded.forEach((month, m) -> {
                if (!m.fingerprint().equals(held.get(month))) {
                    changed.put(month, new HistoryMonthDto(m.fingerprint(), m.sessions()));
                }
            });
            timing.done();
            return new HistorySyncDto(List.copyOf(loaded.keySet()), changed,
                    scope.stream().map(YearMonth::toString).toList());
        }

        Map<String, String> current = historyFingerprints.forPerson(person.getId(), floor);
        timing.fingerprinted();
        List<String> differing = current.entrySet().stream()
                .filter(e -> !e.getValue().equals(held.get(e.getKey())))
                .map(Map.Entry::getKey)
                .toList();
        if (differing.isEmpty()) {
            timing.done();
            return new HistorySyncDto(List.copyOf(current.keySet()), Map.of());
        }

        // `current` is newest first, so the first differing month is the newest and the last the
        // oldest. One contiguous range, filtered below: months in between that did not differ are
        // loaded too but only sent if they changed since step 1, which keeps this one statement.
        YearMonth newest = YearMonth.parse(differing.getFirst());
        YearMonth oldest = YearMonth.parse(differing.getLast());
        Map<String, HistoryMonths.Month> loaded = historyMonths.load(person.getId(), floor,
                oldest.atDay(1).atStartOfDay().toInstant(ZoneOffset.UTC),
                newest.plusMonths(1).atDay(1).atStartOfDay().toInstant(ZoneOffset.UTC));
        timing.loaded(loaded.size());

        Map<String, HistoryMonthDto> changed = new LinkedHashMap<>();
        loaded.forEach((month, m) -> {
            if (!m.fingerprint().equals(held.get(month))) {
                changed.put(month, new HistoryMonthDto(m.fingerprint(), m.sessions()));
            }
        });

        Map<String, String> after = historyFingerprints.forPerson(person.getId(), floor);
        timing.rechecked();
        TreeSet<String> months = new TreeSet<>(Comparator.reverseOrder());
        for (Map.Entry<String, String> e : after.entrySet()) {
            if (loaded.containsKey(e.getKey())) continue;
            if (!Objects.equals(e.getValue(), held.get(e.getKey()))) {
                throw new ServiceUnavailableException("History changed while it was being read. Try again.");
            }
            months.add(e.getKey());
        }
        months.addAll(loaded.keySet());
        timing.done();
        return new HistorySyncDto(List.copyOf(months), changed);
    }

    // Where a slow History sync spent its time, one line per sync that took longer than SLOW_SYNC.
    // Lower is a 5-DTU database whose per-statement costs cannot be read from here or reproduced
    // locally (docs/incidents/2026-09-25-history-full-sync-pegged-lower-db.md), so the split between
    // the fingerprint query, the load and the re-check is logged where it happens rather than guessed.
    // Durations only -- no History content, and the person by id, as every other log line here.
    // System.nanoTime, not the injected Clock: this measures elapsed time, not a moment.
    private static final Duration SLOW_SYNC = Duration.ofMillis(500);

    private static final class SyncTiming {
        private final long personId;
        private final int held;
        private final long start = System.nanoTime();
        private long mark = start;
        private long prepareMs = -1;
        private long fingerprintMs = -1;
        private long loadMs = -1;
        private long recheckMs = -1;
        private int loadedMonths;

        SyncTiming(long personId, int held) {
            this.personId = personId;
            this.held = held;
        }

        private long lap() {
            long now = System.nanoTime();
            long ms = (now - mark) / 1_000_000;
            mark = now;
            return ms;
        }

        void prepared() {
            prepareMs = lap();
        }

        void fingerprinted() {
            fingerprintMs = lap();
        }

        void loaded(int months) {
            loadMs = lap();
            loadedMonths = months;
        }

        void rechecked() {
            recheckMs = lap();
        }

        void done() {
            long totalMs = (System.nanoTime() - start) / 1_000_000;
            if (totalMs < SLOW_SYNC.toMillis()) return;
            log.info("Slow History sync: personId={} held={} loadedMonths={} prepareMs={} fingerprintMs={} loadMs={} "
                            + "recheckMs={} totalMs={}",
                    personId, held, loadedMonths, prepareMs, fingerprintMs, loadMs, recheckMs, totalMs);
        }
    }

    // The production canary for the one failure the History sync must never have: a device holding a
    // month whose fingerprint matches the server's while its content does not. The sync would call that
    // month unchanged forever -- only the daily full sync re-reads it, and that is where the device
    // compares and reports. HistoryFingerprintTest, HistoryConvergenceTest and HistoryConcurrencyTest
    // exist so this never fires; this line is how we would know if one of them missed something.
    //
    // Nothing to fix here -- the full sync has already replaced the month on the device. It is a WARN
    // so it stands out in the logs (docs/architecture/history-sync.md has the query), and it carries
    // month ids only, never workout content.
    @Transactional(readOnly = true)
    public void reportHistoryDrift(AccountAccess access, Long personId, List<String> months) {
        Person person = personService.requireVisiblePerson(personId, access);
        log.warn("History drift: person {} held month(s) {} whose fingerprint matched but whose content did not",
                person.getId(), months);
    }

    // What the Free-tier window is currently hiding from this person, so the three clamped screens
    // (History, PRs, Trends) can say so instead of quietly rendering a partial view.
    //
    // Plus short-circuits with NO QUERY AT ALL: a null floor means nothing is filtered anywhere, so
    // there is nothing to count and nothing to say. Free runs one aggregate -- never a second
    // full-history load.
    //
    // This is a read about billing's effect on data, not a billing gate: it grants nothing, refuses
    // nothing, and a household with no subscription row resolves to Free the same way every other
    // caller of historyFloor does.
    @Transactional(readOnly = true)
    public HistoryWindowDto getHistoryWindow(AccountAccess access, Long personId) {
        Person person = personService.requireVisiblePerson(personId, access);
        Instant floor = subscriptionService.historyFloor(access.accountId());
        if (floor == null) {
            return HistoryWindowDto.unclamped();
        }
        HiddenHistorySummary hidden = workoutSessionRepository.summarizeHiddenBefore(person.getId(), floor);
        long count = hidden == null || hidden.hiddenSessions() == null ? 0L : hidden.hiddenSessions();
        // The floor is reported even when the count is zero. A Free household with nothing hidden
        // yet still needs the boundary date, so PastSessionModal can warn about an out-of-window
        // date BEFORE the workout is logged rather than after it vanishes.
        return new HistoryWindowDto(floor, (int) count, count == 0 ? null : hidden.earliestHiddenAt());
    }
}
