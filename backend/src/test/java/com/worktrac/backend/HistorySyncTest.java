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
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

// POST /api/people/{id}/history/sync end to end: what a client holding some months gets back.
// The decisions under races are in HistorySyncServiceTest; that every write moves the right month's
// fingerprint is HistoryFingerprintTest. This is the protocol a real client sees, and the property
// that ties it to the old endpoint: a client that applies every reply ends up holding exactly what
// GET /history returns.
@AutoConfigureMockMvc
class HistorySyncTest extends AbstractIntegrationTest {

    @DynamicPropertySource
    static void datasource(DynamicPropertyRegistry registry) {
        registerDatasource(registry, HistorySyncTest.class);
    }

    @TestConfiguration
    static class ClockTestConfig {
        @Bean
        @Primary
        MutableClock testClock() {
            return new MutableClock();
        }
    }

    @Autowired private MockMvc mockMvc;
    @Autowired private MutableClock clock;
    @Autowired private TestCodeCache testCodeCache;
    @Autowired private SubscriptionRepository subscriptionRepository;

    @MockitoBean private EmailService emailService;

    private final ObjectMapper objectMapper = new ObjectMapper();

    private String token;
    private long accountId;
    private long personId;
    private long exerciseId;

    @BeforeEach
    void setUp() throws Exception {
        clock.advance(Duration.between(clock.instant(), Instant.parse("2026-06-15T12:00:00Z")));
        String email = "sync-" + UUID.randomUUID().toString().substring(0, 8) + "@example.com";
        JsonNode registration = RegistrationTestSupport.registerAndConfirm(
                mockMvc, objectMapper, testCodeCache, email, "Nate");
        token = registration.get("token").asText();
        accountId = registration.get("account").get("id").asLong();
        personId = registration.get("person").get("id").asLong();
        setFullHistory(true);
        String exercises = mockMvc.perform(get("/api/exercises").header("Authorization", "Bearer " + token))
                .andReturn().getResponse().getContentAsString();
        exerciseId = objectMapper.readTree(exercises).get(0).get("id").asLong();
    }

    @Test
    void aFirstSyncSendsEveryMonthNewestFirstAndAddsUpToHistory() throws Exception {
        logSet(createPastSession("2026-03-10T10:00:00Z"), 100, 5);
        logSet(createPastSession("2026-03-20T10:00:00Z"), 105, 5);
        logSet(createPastSession("2026-05-10T10:00:00Z"), 110, 5);
        logLiveSet(115, 5);

        JsonNode reply = sync(Map.of());

        assertEquals(List.of("2026-06", "2026-05", "2026-03"), months(reply));
        assertEquals(List.of("2026-06", "2026-05", "2026-03"), fieldNames(reply.get("changed")));
        assertEquals(history(), flatten(reply), "the months, concatenated, are exactly GET /history");
    }

    @Test
    void sendingBackWhatItReceivedGetsNothing() throws Exception {
        logSet(createPastSession("2026-03-10T10:00:00Z"), 100, 5);
        logSet(createPastSession("2026-05-10T10:00:00Z"), 110, 5);
        JsonNode first = sync(Map.of());

        JsonNode second = sync(held(first));

        assertEquals(months(first), months(second));
        assertTrue(second.get("changed").isEmpty(), "nothing changed, so nothing is sent");
    }

    @Test
    void afterASetOnlyThatMonthIsSentAndApplyingItMatchesHistory() throws Exception {
        long march = createPastSession("2026-03-10T10:00:00Z");
        logSet(march, 100, 5);
        logSet(createPastSession("2026-05-10T10:00:00Z"), 110, 5);
        JsonNode first = sync(Map.of());

        logSet(march, 102.5, 5);
        JsonNode second = sync(held(first));

        assertEquals(List.of("2026-03"), fieldNames(second.get("changed")));
        assertEquals(history(), flatten(apply(first, second)));
    }

    // Moving a month's only workout elsewhere empties the month: it is simply not listed, and a client
    // applying the reply drops it.
    @Test
    void aMonthThatEmptiesIsNoLongerListed() throws Exception {
        long march = createPastSession("2026-03-10T10:00:00Z");
        logSet(march, 100, 5);
        logSet(createPastSession("2026-05-10T10:00:00Z"), 110, 5);
        JsonNode first = sync(Map.of());

        mockMvc.perform(patch("/api/sessions/" + march)
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of("startedAt", "2026-05-12T10:00:00Z"))))
                .andExpect(status().isOk());
        JsonNode second = sync(held(first));

        assertEquals(List.of("2026-05"), months(second));
        assertEquals(history(), flatten(apply(first, second)));
    }

    // A workout with no sets is not a History row, but its month exists -- sent empty, so creating
    // one and logging into it later both register as changes.
    @Test
    void aMonthWhoseOnlyWorkoutHasNoSetsIsListedEmpty() throws Exception {
        createPastSession("2026-04-10T10:00:00Z");

        JsonNode reply = sync(Map.of());

        assertEquals(List.of("2026-04"), months(reply));
        assertEquals(0, reply.get("changed").get("2026-04").get("sessions").size());
    }

    @Test
    void aFingerprintThatMatchesNothingIsAnsweredWithTheMonthAndUnknownMonthsAreDropped() throws Exception {
        logSet(createPastSession("2026-05-10T10:00:00Z"), 110, 5);

        JsonNode reply = sync(Map.of("2026-05", "not-a-real-fingerprint", "1999-01", "whatever", "junk", "x"));

        assertEquals(List.of("2026-05"), months(reply));
        assertEquals(List.of("2026-05"), fieldNames(reply.get("changed")));
    }

    @Test
    void theFreeWindowHidesOlderMonthsAndAnUpgradeBringsThemBack() throws Exception {
        logSet(createPastSession("2026-01-10T10:00:00Z"), 100, 5);
        logSet(createPastSession("2026-05-10T10:00:00Z"), 110, 5);

        setFullHistory(false);
        JsonNode free = sync(Map.of());
        assertEquals(List.of("2026-05"), months(free));

        setFullHistory(true);
        JsonNode plus = sync(held(free));
        assertEquals(List.of("2026-05", "2026-01"), months(plus));
        assertEquals(List.of("2026-05", "2026-01"), fieldNames(plus.get("changed")),
                "the plan flag is in every fingerprint, so every month is re-sent on upgrade");
    }

    @Test
    void anotherHouseholdCannotSyncThisPersonsHistory() throws Exception {
        String strangerEmail = "stranger-" + UUID.randomUUID().toString().substring(0, 8) + "@example.com";
        String strangerToken = RegistrationTestSupport.registerAndConfirm(
                mockMvc, objectMapper, testCodeCache, strangerEmail, "Stranger").get("token").asText();

        mockMvc.perform(post("/api/people/" + personId + "/history/sync")
                        .header("Authorization", "Bearer " + strangerToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"have\":{}}"))
                .andExpect(status().isNotFound());
    }

    @Test
    void aMissingHaveIsTreatedAsHoldingNothing() throws Exception {
        logSet(createPastSession("2026-05-10T10:00:00Z"), 110, 5);

        String response = mockMvc.perform(post("/api/people/" + personId + "/history/sync")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{}"))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString();

        assertEquals(List.of("2026-05"), fieldNames(objectMapper.readTree(response).get("changed")));
    }

    // The drift canary's endpoint: logs and answers 204 for a person the caller can see, refuses a
    // person it cannot (404, as every person-scoped read), and refuses anything that is not a month id
    // -- it is a line in the logs, so it must never carry content.
    @Test
    void aDriftReportIsAcceptedForYourOwnPersonAndRefusedForAnotherHousehold() throws Exception {
        mockMvc.perform(post("/api/people/" + personId + "/history/drift")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"months\":[\"2026-05\"]}"))
                .andExpect(status().isNoContent());

        String strangerEmail = "drift-" + UUID.randomUUID().toString().substring(0, 8) + "@example.com";
        String strangerToken = RegistrationTestSupport.registerAndConfirm(
                mockMvc, objectMapper, testCodeCache, strangerEmail, "Stranger").get("token").asText();
        mockMvc.perform(post("/api/people/" + personId + "/history/drift")
                        .header("Authorization", "Bearer " + strangerToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"months\":[\"2026-05\"]}"))
                .andExpect(status().isNotFound());
    }

    @Test
    void aDriftReportCarriesMonthIdsAndNothingElse() throws Exception {
        mockMvc.perform(post("/api/people/" + personId + "/history/drift")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"months\":[\"bench 225x5 felt heavy\"]}"))
                .andExpect(status().isBadRequest());
    }

    // ── Helpers ──────────────────────────────────────────────────────────────────────────────

    private JsonNode sync(Map<String, String> have) throws Exception {
        String response = mockMvc.perform(post("/api/people/" + personId + "/history/sync")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of("have", have))))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        return objectMapper.readTree(response);
    }

    // What a client holds after a reply: the fingerprint of every month it was sent.
    private static Map<String, String> held(JsonNode reply) {
        Map<String, String> have = new LinkedHashMap<>();
        reply.get("changed").properties().forEach(e -> have.put(e.getKey(), e.getValue().get("fp").asText()));
        return have;
    }

    // What a client does with a reply: keep each listed month it already holds, take each one sent.
    private JsonNode apply(JsonNode previous, JsonNode reply) {
        var merged = objectMapper.createObjectNode();
        var changed = merged.putObject("changed");
        var months = merged.putArray("months");
        for (JsonNode month : reply.get("months")) {
            String m = month.asText();
            months.add(m);
            changed.set(m, reply.get("changed").has(m) ? reply.get("changed").get(m) : previous.get("changed").get(m));
        }
        return merged;
    }

    private static List<String> months(JsonNode reply) {
        List<String> months = new ArrayList<>();
        reply.get("months").forEach(m -> months.add(m.asText()));
        return months;
    }

    private static List<String> fieldNames(JsonNode node) {
        List<String> names = new ArrayList<>();
        node.properties().forEach(e -> names.add(e.getKey()));
        return names;
    }

    private JsonNode flatten(JsonNode reply) {
        var all = objectMapper.createArrayNode();
        for (JsonNode month : reply.get("months")) {
            reply.get("changed").get(month.asText()).get("sessions").forEach(all::add);
        }
        return all;
    }

    private JsonNode history() throws Exception {
        return objectMapper.readTree(mockMvc.perform(get("/api/people/" + personId + "/history")
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString());
    }

    private void setFullHistory(boolean full) {
        Subscription subscription = subscriptionRepository.findByAccountId(accountId).orElseThrow();
        subscription.setStatus(full ? SubscriptionStatus.ACTIVE : SubscriptionStatus.FREE);
        subscription.setPlan(full ? BillingPlan.PLUS : BillingPlan.FREE);
        subscriptionRepository.save(subscription);
    }

    private long createPastSession(String startedAt) throws Exception {
        String response = mockMvc.perform(post("/api/people/" + personId + "/sessions")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of("startedAt", startedAt))))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
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

    private void logLiveSet(double weight, int reps) throws Exception {
        mockMvc.perform(post("/api/people/" + personId + "/live-sets")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(
                                Map.of("exerciseId", exerciseId, "weight", weight, "reps", reps))))
                .andExpect(status().isOk());
    }
}
