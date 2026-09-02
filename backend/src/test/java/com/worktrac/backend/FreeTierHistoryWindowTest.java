package com.worktrac.backend;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.worktrac.backend.billing.BillingPlan;
import com.worktrac.backend.billing.Subscription;
import com.worktrac.backend.billing.SubscriptionRepository;
import com.worktrac.backend.billing.SubscriptionStatus;
import com.worktrac.backend.email.EmailService;
import com.worktrac.backend.support.AbstractIntegrationTest;
import com.worktrac.backend.support.MutableClock;
import com.worktrac.backend.support.RegistrationTestSupport;
import com.worktrac.backend.user.TestCodeCache;
import com.worktrac.backend.workoutset.WorkoutSetRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;
import org.springframework.http.MediaType;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

import java.time.Duration;
import java.time.Instant;
import java.util.Map;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

// The Free-tier 90-day window, and the promise it must not break.
//
// The marketing site states twice, in writing, that "Your workouts are never deleted on Free" and
// "Nothing is deleted, ever". That makes this a commitment rather than an implementation detail,
// so the central test here is a ROUND TRIP: clip, verify hidden, restore, verify the identical
// sessions come back with the identical underlying row count.
//
// A test that only asserted "hidden while Free" would pass just as happily against an
// implementation that deleted the rows -- which is exactly the regression worth guarding against,
// since deleting them is the obvious way to make a history query faster.
@AutoConfigureMockMvc
class FreeTierHistoryWindowTest extends AbstractIntegrationTest {

    @DynamicPropertySource
    static void datasource(DynamicPropertyRegistry registry) {
        registerDatasource(registry, FreeTierHistoryWindowTest.class);
    }

    @TestConfiguration
    static class ClockTestConfig {
        @Bean
        @Primary
        MutableClock testClock() {
            return new MutableClock();
        }
    }

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private MutableClock clock;

    @Autowired
    private TestCodeCache testCodeCache;

    @Autowired
    private SubscriptionRepository subscriptionRepository;

    @Autowired
    private WorkoutSetRepository workoutSetRepository;

    @MockitoBean
    private EmailService emailService;

    private final ObjectMapper objectMapper = new ObjectMapper();

    private String token;
    private long accountId;
    private long personId;
    private long exerciseId;

    @BeforeEach
    void setUp() throws Exception {
        clock.advance(Duration.between(clock.instant(), Instant.parse("2026-06-15T12:00:00Z")));

        String email = "window-" + UUID.randomUUID().toString().substring(0, 8) + "@example.com";
        JsonNode registration = RegistrationTestSupport.registerAndConfirm(
                mockMvc, objectMapper, testCodeCache, email, "Nate");
        token = registration.get("token").asText();
        accountId = registration.get("account").get("id").asLong();
        personId = registration.get("person").get("id").asLong();

        String exercises = mockMvc.perform(get("/api/exercises").header("Authorization", "Bearer " + token))
                .andReturn().getResponse().getContentAsString();
        exerciseId = objectMapper.readTree(exercises).get(0).get("id").asLong();
    }

    private long createPastSession(String startedAt) throws Exception {
        String response = mockMvc.perform(post("/api/people/" + personId + "/sessions")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of("startedAt", startedAt))))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        return objectMapper.readTree(response).get("id").asLong();
    }

    private void logSet(long sessionId, double weight, int reps) throws Exception {
        mockMvc.perform(post("/api/sessions/" + sessionId + "/sets")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(
                                Map.of("exerciseId", exerciseId, "weight", weight, "reps", reps))))
                .andExpect(status().isOk());
    }

    private JsonNode getHistory() throws Exception {
        String response = mockMvc.perform(get("/api/people/" + personId + "/history")
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        return objectMapper.readTree(response);
    }

    private JsonNode getPrs() throws Exception {
        String response = mockMvc.perform(get("/api/people/" + personId + "/prs")
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        return objectMapper.readTree(response);
    }

    private JsonNode getHistoryWindow() throws Exception {
        String response = mockMvc.perform(get("/api/people/" + personId + "/history-window")
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        return objectMapper.readTree(response);
    }

    private JsonNode getTrendsOverview() throws Exception {
        String response = mockMvc.perform(get("/api/people/" + personId + "/trends/overview")
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        return objectMapper.readTree(response);
    }

    // Deliberately this PERSON's sets, not workoutSetRepository.count(): that counts the whole
    // database, which in a shared test database includes every other case in this class. The
    // promise is about a household's own rows surviving, so that is what gets counted.
    private long storedSetCount() {
        return workoutSetRepository.findByPerson_IdOrderByCreatedAtAscIdAsc(personId).size();
    }

    private void setPro(boolean pro) {
        Subscription subscription = subscriptionRepository.findByAccountId(accountId).orElseThrow();
        subscription.setStatus(pro ? SubscriptionStatus.ACTIVE : SubscriptionStatus.FREE);
        subscription.setPlan(pro ? BillingPlan.PRO : BillingPlan.FREE);
        subscriptionRepository.save(subscription);
    }

    // Two sessions: one comfortably inside the 90-day window, one comfortably outside it.
    private void seedOldAndRecent() throws Exception {
        long old = createPastSession("2026-01-10T10:00:00Z");   // ~156 days before "today"
        logSet(old, 225, 5);
        long recent = createPastSession("2026-06-01T10:00:00Z"); // ~14 days before "today"
        logSet(recent, 135, 5);
    }

    // ── The promise ────────────────────────────────────────────────────────────────────────────

    @Test
    void freeHidesOlderSessionsButProBringsThemBackUnchanged() throws Exception {
        seedOldAndRecent();
        long rowsAfterSeeding = storedSetCount();

        setPro(true);
        assertEquals(2, getHistory().size(), "Pro should see the whole history");

        setPro(false);
        JsonNode clipped = getHistory();
        assertEquals(1, clipped.size(), "Free should see only the session inside the window");
        assertTrue(clipped.get(0).get("startedAt").asText().startsWith("2026-06-01"));

        // ⚠️ THE ASSERTION THAT MATTERS. Hiding is a read filter; the rows must be untouched. An
        // implementation that deleted them would satisfy every other assertion in this test.
        assertEquals(rowsAfterSeeding, storedSetCount(),
                "Clipping history must never delete a single row");

        setPro(true);
        JsonNode restored = getHistory();
        assertEquals(2, restored.size(), "Re-subscribing must restore the full history");
        assertEquals(rowsAfterSeeding, storedSetCount());
    }

    // The window moves with the clock rather than being stamped anywhere, so a session that was
    // visible yesterday simply falls out of view -- with, again, nothing deleted.
    @Test
    void theWindowSlidesWithTheClock() throws Exception {
        long session = createPastSession("2026-06-01T10:00:00Z");
        logSet(session, 135, 5);
        setPro(false);
        assertEquals(1, getHistory().size());

        clock.advance(Duration.ofDays(120));

        assertEquals(0, getHistory().size(), "The session is now outside the window");
        assertEquals(1, storedSetCount(), "...but the row is still there");
    }

    // ── PR detection vs PR display ─────────────────────────────────────────────────────────────

    @Test
    void freeShowsOnlyRecordsInsideTheWindow() throws Exception {
        seedOldAndRecent();
        setPro(false);

        JsonNode prs = getPrs();

        assertEquals(1, prs.size());
        // 135, the best INSIDE the window -- not the 225 lifted in January.
        assertEquals(135, prs.get(0).get("best").get("weight").asDouble(), 0.01);
    }

    // The subtle one, and the reason detection and display are deliberately separate code paths.
    // A Free household whose all-time best is outside the window must NOT be told a lesser set is
    // a personal record: a false celebration is worse than a withheld one, and the celebration is
    // the emotional core of this app.
    @Test
    void freeIsNotCongratulatedForBeatingOnlyTheVisibleWindow() throws Exception {
        long old = createPastSession("2026-01-10T10:00:00Z");
        logSet(old, 225, 5); // the real all-time best, outside the window
        setPro(false);

        long today = createPastSession("2026-06-14T10:00:00Z");
        String response = mockMvc.perform(post("/api/sessions/" + today + "/sets")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(
                                Map.of("exerciseId", exerciseId, "weight", 185, "reps", 5))))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();

        // 185 beats everything Free can SEE, and beats nothing the person has actually done.
        assertEquals(false, objectMapper.readTree(response).get("isPR").asBoolean(),
                "Detection must read the whole history, not the visible window");
    }

    @Test
    void freeStillGetsARealPr() throws Exception {
        long old = createPastSession("2026-01-10T10:00:00Z");
        logSet(old, 225, 5);
        setPro(false);

        long today = createPastSession("2026-06-14T10:00:00Z");
        String response = mockMvc.perform(post("/api/sessions/" + today + "/sets")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(
                                Map.of("exerciseId", exerciseId, "weight", 275, "reps", 5))))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();

        assertEquals(true, objectMapper.readTree(response).get("isPR").asBoolean(),
                "Beating the genuine all-time best is still a PR on Free");
    }

    // -- Telling the person what is hidden --------------------------------------------------

    // The count is only worth showing if it is exactly right, so this asserts the two halves add
    // up rather than merely that the count is non-zero: what Free can see, plus what it is told is
    // hidden, must equal what Pro sees. A count derived from a slightly different filter than
    // getHistory's would satisfy a "> 0" assertion and still lie to the person.
    @Test
    void freeIsToldExactlyHowManyWorkoutsAreHidden() throws Exception {
        seedOldAndRecent();
        setPro(false);

        JsonNode window = getHistoryWindow();
        assertEquals(1, window.get("hiddenSessions").asInt());
        assertTrue(window.get("earliestHiddenAt").asText().startsWith("2026-01-10"),
                "The explainer names a real date, so it must be the oldest hidden session");
        assertTrue(window.get("windowStart").asText().startsWith("2026-03-17"),
                "90 days before the frozen 2026-06-15 test clock");

        int visible = getHistory().size();
        setPro(true);
        assertEquals(getHistory().size(), visible + window.get("hiddenSessions").asInt(),
                "visible + hidden must account for every session Pro can see");
    }

    // Pro has no floor, so there is nothing to report and no query to run.
    @Test
    void proIsToldNothingIsHidden() throws Exception {
        seedOldAndRecent();
        setPro(true);

        JsonNode window = getHistoryWindow();
        assertTrue(window.get("windowStart").isNull(), "A null floor is what marks a household Pro");
        assertEquals(0, window.get("hiddenSessions").asInt());
        assertTrue(window.get("earliestHiddenAt").isNull());
    }

    @Test
    void compedHouseholdsAreToldNothingIsHidden() throws Exception {
        seedOldAndRecent();
        Subscription subscription = subscriptionRepository.findByAccountId(accountId).orElseThrow();
        subscription.setComped(true);
        subscriptionRepository.save(subscription);

        assertEquals(0, getHistoryWindow().get("hiddenSessions").asInt(),
                "Comped is Pro everywhere, here too -- no second code path");
    }

    // getHistory drops sessions with no sets, so counting them here would promise the person more
    // hidden workouts than upgrading could ever show them. An abandoned retroactive session is the
    // realistic way to end up with one.
    @Test
    void anEmptyOldSessionIsNotCountedAsHidden() throws Exception {
        createPastSession("2026-01-10T10:00:00Z"); // created, never logged into
        setPro(false);

        JsonNode window = getHistoryWindow();
        assertEquals(0, window.get("hiddenSessions").asInt(),
                "A session with no sets is not a History row, so it is not a hidden one either");
        assertTrue(window.get("earliestHiddenAt").isNull());
    }

    // The boundary is reported even with nothing behind it yet. This is what lets the app warn
    // someone picking an out-of-window date in "Log a past workout" BEFORE they log the workout,
    // instead of explaining afterwards why it vanished -- and it is why the client never computes
    // the 90 days itself.
    @Test
    void aFreeHouseholdWithNothingHiddenStillLearnsTheBoundary() throws Exception {
        long recent = createPastSession("2026-06-01T10:00:00Z");
        logSet(recent, 135, 5);
        setPro(false);

        JsonNode window = getHistoryWindow();
        assertEquals(0, window.get("hiddenSessions").asInt());
        assertTrue(window.get("windowStart").isTextual(),
                "Free always reports its floor, even when nothing has fallen behind it yet");
    }

    // The count follows the clock for the same reason the clamp does.
    @Test
    void theHiddenCountSlidesWithTheClock() throws Exception {
        long session = createPastSession("2026-06-01T10:00:00Z");
        logSet(session, 135, 5);
        setPro(false);
        assertEquals(0, getHistoryWindow().get("hiddenSessions").asInt());

        clock.advance(Duration.ofDays(120));

        assertEquals(1, getHistoryWindow().get("hiddenSessions").asInt(),
                "The session fell out of the window, so it is now reported as hidden");
        assertEquals(1, storedSetCount(), "...and is still in the database");
    }

    // REGRESSION. hasAnyHistory was computed from the CLAMPED set list, so a Free household whose
    // entire training history predates the window was told "No workouts logged yet. Trends will
    // show up here once a few sessions are in the books." -- by the exact field that exists to
    // separate a new person from a lapsed one. The window clamps DISPLAY; it must never change
    // what the app believes about the person.
    @Test
    void aFreeHouseholdWithOnlyOldHistoryIsNotToldItHasNeverTrained() throws Exception {
        long old = createPastSession("2026-01-10T10:00:00Z");
        logSet(old, 225, 5);
        setPro(false);

        JsonNode overview = getTrendsOverview();
        assertTrue(overview.get("hasAnyHistory").asBoolean(),
                "They have years of history; only the last 90 days of it are visible");
    }
    // ── Comped households ──────────────────────────────────────────────────────────────────────

    @Test
    void compedHouseholdsSeeEverything() throws Exception {
        seedOldAndRecent();
        Subscription subscription = subscriptionRepository.findByAccountId(accountId).orElseThrow();
        subscription.setComped(true);
        subscriptionRepository.save(subscription);

        assertEquals(2, getHistory().size(),
                "A comped household is Pro everywhere, with no second code path");
    }
}
