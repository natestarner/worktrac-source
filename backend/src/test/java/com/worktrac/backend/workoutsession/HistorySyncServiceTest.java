package com.worktrac.backend.workoutsession;

import com.worktrac.backend.billing.BillingPlan;
import com.worktrac.backend.billing.SubscriptionService;
import com.worktrac.backend.common.ServiceUnavailableException;
import com.worktrac.backend.membership.AccountAccess;
import com.worktrac.backend.membership.AccountRole;
import com.worktrac.backend.person.Person;
import com.worktrac.backend.person.PersonService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.time.Clock;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

// The sync's decisions, in isolation: which months it loads, which it sends, which it lists, and
// when it refuses. The races are the reason this exists -- a write landing between the steps of one
// request is not something an integration test can stage on demand, but it is exactly the case
// where getting it wrong would leave a device holding a month that no longer matches its
// fingerprint. HistoryFingerprintTest and HistorySyncTest cover the same code against a database.
class HistorySyncServiceTest {

    private static final long PERSON = 7L;
    private static final AccountAccess ACCESS =
            new AccountAccess(1L, 100L, 5L, AccountRole.OWNER, PERSON, true, BillingPlan.PLUS, null);

    private final HistoryMonths historyMonths = mock(HistoryMonths.class);
    private final HistoryFingerprints historyFingerprints = mock(HistoryFingerprints.class);
    private final SubscriptionService subscriptionService = mock(SubscriptionService.class);
    private WorkoutSessionService service;

    @BeforeEach
    void setUp() {
        PersonService personService = mock(PersonService.class);
        Person person = mock(Person.class);
        when(person.getId()).thenReturn(PERSON);
        when(personService.requireVisiblePerson(PERSON, ACCESS)).thenReturn(person);
        service = new WorkoutSessionService(mock(WorkoutSessionRepository.class), historyMonths,
                historyFingerprints, personService, subscriptionService, Clock.systemUTC());
    }

    @Test
    void whenNothingDiffersNothingIsLoadedAndEveryMonthIsKept() {
        fingerprintsAre(map("2026-06", "a", "2026-05", "b"));

        HistorySyncDto reply = service.syncHistory(ACCESS, PERSON, map("2026-06", "a", "2026-05", "b"));

        assertEquals(List.of("2026-06", "2026-05"), reply.months());
        assertTrue(reply.changed().isEmpty());
        verify(historyMonths, never()).load(anyLong(), any(), any(), any());
    }

    // A device holding nothing gets everything from ONE load -- no fingerprint query before it, no
    // re-check after. Neither could change the answer: every month differs from nothing, and there is
    // no kept month to protect. On lower those two queries were ~0.5s of a five-year full sync.
    @Test
    void anEmptyHaveIsOneLoadOfEverythingAndNothingElse() {
        loads(null, null, months("2026-06", "a", "2026-03", "c"));

        for (Map<String, String> nothing : java.util.Arrays.asList(null, Map.<String, String>of())) {
            HistorySyncDto reply = service.syncHistory(ACCESS, PERSON, nothing);

            assertEquals(List.of("2026-06", "2026-03"), reply.months());
            assertEquals(List.of("2026-06", "2026-03"), List.copyOf(reply.changed().keySet()));
            assertEquals("a", reply.changed().get("2026-06").fp());
        }
        verify(historyFingerprints, never()).forPerson(anyLong(), any());
    }

    // The re-check's refusal protects a month the device keeps. A full sync keeps none, so a month
    // created mid-request cannot refuse it -- the load is one snapshot, and the month arrives next time.
    @Test
    void aFullSyncIsNeverRefused() {
        loads(null, null, months("2026-06", "a"));
        fingerprintsAre(map("2026-06", "a", "2026-02", "appeared-mid-request"));

        HistorySyncDto reply = service.syncHistory(ACCESS, PERSON, Map.of());

        assertEquals(List.of("2026-06"), reply.months());
    }

    @Test
    void onlyTheRangeSpanningTheDifferingMonthsIsLoaded() {
        fingerprintsAre(map("2026-06", "a", "2026-05", "b", "2026-03", "c"));
        loads(Instant.parse("2026-06-01T00:00:00Z"), Instant.parse("2026-07-01T00:00:00Z"),
                months("2026-06", "a"));

        HistorySyncDto reply = service.syncHistory(ACCESS, PERSON, map("2026-06", "old", "2026-05", "b", "2026-03", "c"));

        assertEquals(List.of("2026-06", "2026-05", "2026-03"), reply.months());
        assertEquals(List.of("2026-06"), List.copyOf(reply.changed().keySet()));
    }

    // Two differing months with an unchanged one between them: one statement loads all three, and
    // the middle one is listed but not re-sent.
    @Test
    void aLoadedMonthThatStillMatchesWhatTheClientHoldsIsListedButNotResent() {
        fingerprintsAre(map("2026-06", "a", "2026-05", "b", "2026-04", "c"));
        loads(Instant.parse("2026-04-01T00:00:00Z"), Instant.parse("2026-07-01T00:00:00Z"),
                months("2026-06", "a", "2026-05", "b", "2026-04", "c"));

        HistorySyncDto reply = service.syncHistory(ACCESS, PERSON, map("2026-06", "x", "2026-05", "b", "2026-04", "y"));

        assertEquals(List.of("2026-06", "2026-05", "2026-04"), reply.months());
        assertEquals(List.of("2026-06", "2026-04"), List.copyOf(reply.changed().keySet()));
    }

    @Test
    void aMonthTheClientHoldsThatNoLongerExistsIsNotListed() {
        fingerprintsAre(map("2026-06", "a"));

        HistorySyncDto reply = service.syncHistory(ACCESS, PERSON, map("2026-06", "a", "2026-01", "z"));

        assertEquals(List.of("2026-06"), reply.months());
        assertTrue(reply.changed().isEmpty());
    }

    // The fingerprint said March differed, but by the time the one statement ran it had no workouts
    // left at all: it is neither sent nor listed, so the device drops it.
    @Test
    void aMonthThatEmptiedBeforeTheLoadIsDropped() {
        fingerprintsAre(map("2026-06", "a", "2026-03", "c"), map("2026-06", "a"));
        loads(Instant.parse("2026-03-01T00:00:00Z"), Instant.parse("2026-04-01T00:00:00Z"), months());

        HistorySyncDto reply = service.syncHistory(ACCESS, PERSON, map("2026-06", "a", "2026-03", "old"));

        assertEquals(List.of("2026-06"), reply.months());
        assertTrue(reply.changed().isEmpty());
    }

    // The whole point of the final re-check. June is re-sent; meanwhile a workout moves from June
    // into March, which the client holds and which was NOT loaded. Keeping March would lose the
    // workout on the device (it is in neither month). Refuse, and let the client ask again.
    @Test
    void aKeptMonthThatChangedDuringTheRequestIsRefusedNotSilentlyKept() {
        fingerprintsAre(map("2026-06", "a", "2026-03", "c"), map("2026-06", "a2", "2026-03", "c2"));
        loads(Instant.parse("2026-06-01T00:00:00Z"), Instant.parse("2026-07-01T00:00:00Z"),
                months("2026-06", "a2"));

        assertThrows(ServiceUnavailableException.class,
                () -> service.syncHistory(ACCESS, PERSON, map("2026-06", "old", "2026-03", "c")));
    }

    @Test
    void aMonthThatAppearedDuringTheRequestIsRefused() {
        fingerprintsAre(map("2026-06", "a"), map("2026-06", "a", "2026-02", "new"));
        loads(Instant.parse("2026-06-01T00:00:00Z"), Instant.parse("2026-07-01T00:00:00Z"),
                months("2026-06", "a"));

        assertThrows(ServiceUnavailableException.class,
                () -> service.syncHistory(ACCESS, PERSON, map("2026-06", "old")));
    }

    // A month that was loaded is sent with the fingerprint of the rows that built it, whatever the
    // aggregate said before or after -- that pairing is what the client trusts next time.
    @Test
    void aLoadedMonthCarriesTheFingerprintOfItsOwnRows() {
        fingerprintsAre(map("2026-06", "a"), map("2026-06", "a3"));
        loads(Instant.parse("2026-06-01T00:00:00Z"), Instant.parse("2026-07-01T00:00:00Z"),
                months("2026-06", "a2"));

        HistorySyncDto reply = service.syncHistory(ACCESS, PERSON, map("2026-06", "old"));

        assertEquals("a2", reply.changed().get("2026-06").fp());
    }

    @Test
    void theFreeTierFloorReachesBothTheFingerprintsAndTheLoad() {
        Instant floor = Instant.parse("2026-03-17T12:00:00Z");
        when(subscriptionService.historyFloor(100L)).thenReturn(floor);
        when(historyFingerprints.forPerson(PERSON, floor)).thenReturn(map("2026-06", "a"));
        when(historyMonths.load(PERSON, floor, Instant.parse("2026-06-01T00:00:00Z"),
                Instant.parse("2026-07-01T00:00:00Z"))).thenReturn(months("2026-06", "a"));

        HistorySyncDto reply = service.syncHistory(ACCESS, PERSON, map("2026-06", "old"));

        assertEquals(List.of("2026-06"), reply.months());
    }

    @Test
    void theFreeTierFloorReachesAFullSyncsLoad() {
        Instant floor = Instant.parse("2026-03-17T12:00:00Z");
        when(subscriptionService.historyFloor(100L)).thenReturn(floor);
        when(historyMonths.load(PERSON, floor, null, null)).thenReturn(months("2026-06", "a"));

        HistorySyncDto reply = service.syncHistory(ACCESS, PERSON, Map.of());

        assertEquals(List.of("2026-06"), reply.months());
    }

    // ── Helpers ──────────────────────────────────────────────────────────────────────────────

    @SafeVarargs
    private void fingerprintsAre(Map<String, String> first, Map<String, String>... then) {
        when(historyFingerprints.forPerson(PERSON, null)).thenReturn(first, then.length == 0 ? new Map[] {first} : then);
    }

    private void loads(Instant from, Instant to, Map<String, HistoryMonths.Month> months) {
        when(historyMonths.load(PERSON, null, from, to)).thenReturn(months);
    }

    private static Map<String, String> map(String... pairs) {
        Map<String, String> map = new LinkedHashMap<>();
        for (int i = 0; i < pairs.length; i += 2) map.put(pairs[i], pairs[i + 1]);
        return map;
    }

    private static Map<String, HistoryMonths.Month> months(String... pairs) {
        Map<String, HistoryMonths.Month> map = new LinkedHashMap<>();
        for (int i = 0; i < pairs.length; i += 2) map.put(pairs[i], new HistoryMonths.Month(pairs[i + 1], List.of()));
        return map;
    }
}
