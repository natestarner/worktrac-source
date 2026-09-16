package com.worktrac.backend.account;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.worktrac.backend.email.EmailService;
import com.worktrac.backend.support.AbstractIntegrationTest;
import com.worktrac.backend.support.RegistrationTestSupport;
import com.worktrac.backend.user.TestCodeCache;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * The trainer's roster — the one screen that answers "who has stopped showing up?".
 *
 * <p>Most of what matters here is ordering and what counts as a workout, because both are silent
 * when wrong: a roster in the wrong order still looks like a roster, and a client credited with an
 * abandoned session still looks like they trained.
 */
@AutoConfigureMockMvc
class RosterTest extends AbstractIntegrationTest {

    // ⚠️ WITHOUT THIS, THIS CLASS TALKS TO WHATEVER IS ON localhost:1434 -- which on a developer's
    // machine is their real local SQL Server, and in CI is nothing at all. AbstractIntegrationTest
    // cannot hoist it: a static @DynamicPropertySource has no way to learn which concrete subclass
    // triggered it, so each one passes its own identity. Omitting it does not fail loudly; it falls
    // back to application-local.yml and passes locally while failing every time on a clean machine.
    @DynamicPropertySource
    static void datasource(DynamicPropertyRegistry registry) {
        registerDatasource(registry, RosterTest.class);
    }

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private TestCodeCache testCodeCache;

    // Every integration test needs this: the real sender would try to reach ACS.
    @MockitoBean
    private EmailService emailService;

    private final ObjectMapper objectMapper = new ObjectMapper();

    private String ownerToken;
    private String ownerEmail;
    private long natePersonId;

    @BeforeEach
    void setUpPractice() throws Exception {
        String suffix = UUID.randomUUID().toString().substring(0, 8);
        ownerEmail = "trainer-" + suffix + "@example.com";
        JsonNode registered = RegistrationTestSupport
                .registerAndConfirm(mockMvc, objectMapper, testCodeCache, ownerEmail, "Nate");
        ownerToken = registered.get("token").asText();

        natePersonId = json(mockMvc.perform(get("/api/people").header("Authorization", bearer(ownerToken))))
                .get(0).get("id").asLong();
    }

    private String bearer(String token) {
        return "Bearer " + token;
    }

    private JsonNode json(ResultActions actions) throws Exception {
        return objectMapper.readTree(actions.andReturn().getResponse().getContentAsString());
    }

    private long addPerson(String name) throws Exception {
        return json(mockMvc.perform(post("/api/people")
                .header("Authorization", bearer(ownerToken))
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(Map.of("name", name)))))
                .get("id").asLong();
    }

    /** A session with no sets in it — an abandoned retroactive entry, not a workout. */
    private long emptySessionFor(long personId, Instant startedAt) throws Exception {
        return json(mockMvc.perform(post("/api/people/" + personId + "/sessions")
                .header("Authorization", bearer(ownerToken))
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(Map.of("startedAt", startedAt.toString())))))
                .get("id").asLong();
    }

    private void workoutFor(long personId, Instant startedAt) throws Exception {
        long sessionId = emptySessionFor(personId, startedAt);
        long exerciseId = json(mockMvc.perform(get("/api/exercises")
                .header("Authorization", bearer(ownerToken))))
                .get(0).get("id").asLong();

        mockMvc.perform(post("/api/sessions/" + sessionId + "/sets")
                        .header("Authorization", bearer(ownerToken))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of(
                                "exerciseId", exerciseId, "weight", 100, "reps", 5))))
                .andExpect(status().isOk());
    }

    private JsonNode roster(String token) throws Exception {
        return json(mockMvc.perform(get("/api/account/roster")
                        .param("zone", "UTC")
                        .header("Authorization", bearer(token)))
                .andExpect(status().isOk()));
    }

    private List<String> namesOnRoster(String token) throws Exception {
        List<String> names = new ArrayList<>();
        roster(token).forEach(row -> names.add(row.get("personName").asText()));
        return names;
    }

    private JsonNode rowFor(String token, String name) throws Exception {
        for (JsonNode row : roster(token)) {
            if (row.get("personName").asText().equals(name)) {
                return row;
            }
        }
        throw new AssertionError(name + " is not on the roster");
    }

    @Nested
    @DisplayName("what counts as a workout")
    class WhatCounts {

        // ⚠️ The EXISTS sub-select behind this is not an optimisation. getHistory drops sessions
        // with no sets, so counting them here would tell a trainer their client trained on a day
        // the client's own History screen shows as empty -- and the trainer would be the one who
        // brought it up.
        @Test
        void anAbandonedSessionWithNoSetsIsNotOne() throws Exception {
            long sam = addPerson("Sam");
            emptySessionFor(sam, Instant.now().minus(2, ChronoUnit.DAYS));

            JsonNode row = rowFor(ownerToken, "Sam");

            assertThat(row.get("lastWorkoutAt").isNull()).isTrue();
            assertThat(row.get("sessionsInWindow").asInt()).isZero();
            assertThat(row.get("currentStreakWeeks").asInt()).isZero();
        }

        @Test
        void aSessionWithSetsIs() throws Exception {
            long sam = addPerson("Sam");
            workoutFor(sam, Instant.now().minus(2, ChronoUnit.DAYS));

            JsonNode row = rowFor(ownerToken, "Sam");

            assertThat(row.get("lastWorkoutAt").isNull()).isFalse();
            assertThat(row.get("sessionsInWindow").asInt()).isEqualTo(1);
            assertThat(row.get("daysSinceLastWorkout").asInt()).isEqualTo(2);
        }

        // Null, never a sentinel. A 9999 would sort correctly and then render to a reader as a real
        // number of days -- the kind of value that reaches a screenshot before anybody notices.
        @Test
        void somebodyWhoHasNeverTrainedReportsNullRatherThanAHugeNumber() throws Exception {
            addPerson("Sam");

            JsonNode row = rowFor(ownerToken, "Sam");

            assertThat(row.get("daysSinceLastWorkout").isNull()).isTrue();
            assertThat(row.get("lastWorkoutAt").isNull()).isTrue();
        }
    }

    @Nested
    @DisplayName("quietest first")
    class QuietestFirst {

        // The whole point of the default order: the answer is at the top rather than found by
        // scrolling a roster of forty.
        @Test
        void putsTheLongestSilenceAboveTheMostRecentWorkout() throws Exception {
            long quiet = addPerson("Quiet");
            long busy = addPerson("Busy");
            workoutFor(quiet, Instant.now().minus(30, ChronoUnit.DAYS));
            workoutFor(busy, Instant.now().minus(1, ChronoUnit.DAYS));

            assertThat(namesOnRoster(ownerToken)).containsSubsequence("Quiet", "Busy");
        }

        // ⚠️ Never-logged is the MOST urgent row, not the least. A "never" sorted to the bottom is
        // precisely the client who quietly never started -- the one a trainer most needs to see.
        @Test
        void putsSomebodyWhoHasNeverTrainedAboveEverybody() throws Exception {
            long quiet = addPerson("Quiet");
            addPerson("Never");
            workoutFor(quiet, Instant.now().minus(60, ChronoUnit.DAYS));

            assertThat(namesOnRoster(ownerToken)).containsSubsequence("Never", "Quiet");
        }

        // Without a total order the list comes back differently on two consecutive loads for people
        // whose numbers match -- which on a roster of clients who all trained yesterday is most of
        // them, and reads as the screen being broken.
        @Test
        void breaksTiesByNameSoTheOrderIsStable() throws Exception {
            addPerson("Zoe");
            addPerson("Adam");

            assertThat(namesOnRoster(ownerToken)).isEqualTo(namesOnRoster(ownerToken));
            assertThat(namesOnRoster(ownerToken)).containsSubsequence("Adam", "Nate", "Zoe");
        }
    }

    @Nested
    @DisplayName("who appears on it")
    class WhoAppears {

        @Test
        void everyPersonInTheAccountForTheOwner() throws Exception {
            addPerson("Sam");
            addPerson("Alex");

            assertThat(namesOnRoster(ownerToken)).containsExactlyInAnyOrder("Nate", "Sam", "Alex");
        }

        @Test
        void reportsWhetherEachPersonCanSignInThemselves() throws Exception {
            addPerson("Sam");

            // The owner's own person has a login by construction; a freshly added person does not.
            assertThat(rowFor(ownerToken, "Nate").get("hasLogin").asBoolean()).isTrue();
            assertThat(rowFor(ownerToken, "Sam").get("hasLogin").asBoolean()).isFalse();
        }

        @Test
        void neverIncludesAnotherAccount() throws Exception {
            String otherSuffix = UUID.randomUUID().toString().substring(0, 8);
            RegistrationTestSupport.registerAndConfirm(mockMvc, objectMapper, testCodeCache,
                    "other-" + otherSuffix + "@example.com", "Stranger");

            assertThat(namesOnRoster(ownerToken)).doesNotContain("Stranger");
        }
    }

    @Nested
    @DisplayName("the owner's own person")
    class OwnersOwnPerson {

        @Test
        void isOnTheRosterLikeAnybodyElse() throws Exception {
            assertThat(namesOnRoster(ownerToken)).contains("Nate");
            assertThat(rowFor(ownerToken, "Nate").get("personId").asLong()).isEqualTo(natePersonId);
        }
    }
}
