package com.worktrac.backend.checkin;

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

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Check-ins, and above all who can read a private one.
 *
 * <p>The privacy here is not a convenience. A trainer's private observation about a client is the
 * most sensitive thing this product stores, and the failure is silent: a leak renders as an
 * ordinary timeline entry, indistinguishable from one written for them.
 */
@AutoConfigureMockMvc
class CheckInTest extends AbstractIntegrationTest {

    // ⚠️ WITHOUT THIS, THIS CLASS TALKS TO WHATEVER IS ON localhost:1434 -- which on a developer's
    // machine is their real local SQL Server, and in CI is nothing at all. AbstractIntegrationTest
    // cannot hoist it: a static @DynamicPropertySource has no way to learn which concrete subclass
    // triggered it, so each one passes its own identity. Omitting it does not fail loudly; it falls
    // back to application-local.yml and passes locally while failing every time on a clean machine.
    @DynamicPropertySource
    static void datasource(DynamicPropertyRegistry registry) {
        registerDatasource(registry, CheckInTest.class);
    }

    private static final String TEST_KEY = "local-dev-only-e2e-test-key-do-not-use-elsewhere";

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private TestCodeCache testCodeCache;

    @MockitoBean
    private EmailService emailService;

    private final ObjectMapper objectMapper = new ObjectMapper();

    private String trainerToken;
    private String trainerEmail;
    private long danaPersonId;
    private String suffix;

    @BeforeEach
    void setUpPractice() throws Exception {
        suffix = UUID.randomUUID().toString().substring(0, 8);
        trainerEmail = "trainer-" + suffix + "@example.com";
        trainerToken = RegistrationTestSupport
                .registerAndConfirm(mockMvc, objectMapper, testCodeCache, trainerEmail, "Nate")
                .get("token").asText();

        // A paid tier: member logins are gated on it, and a paused member is refused everywhere.
        mockMvc.perform(post("/api/auth/test/billing-plan")
                        .header("X-E2E-Test-Key", TEST_KEY)
                        .param("email", trainerEmail)
                        .param("plan", "PRO"))
                .andExpect(status().isNoContent());

        danaPersonId = json(mockMvc.perform(post("/api/people")
                .header("Authorization", bearer(trainerToken))
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(Map.of("name", "Dana")))))
                .get("id").asLong();
    }

    private String bearer(String token) {
        return "Bearer " + token;
    }

    private JsonNode json(ResultActions actions) throws Exception {
        return objectMapper.readTree(actions.andReturn().getResponse().getContentAsString());
    }

    /** Signs in as a member attached to the named person, the way the e2e helper does. */
    private String memberTokenFor(String personName) throws Exception {
        String memberEmail = "member-" + personName.toLowerCase() + "-" + suffix + "@example.com";
        mockMvc.perform(post("/api/auth/test/member")
                        .header("X-E2E-Test-Key", TEST_KEY)
                        .param("ownerEmail", trainerEmail)
                        .param("personName", personName)
                        .param("memberEmail", memberEmail)
                        .param("password", "password123"))
                .andExpect(status().isNoContent());

        return json(mockMvc.perform(post("/api/auth/login")
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(
                        Map.of("email", memberEmail, "password", "password123")))))
                .get("token").asText();
    }

    private ResultActions addCheckIn(String token, long personId, Map<String, Object> body) throws Exception {
        return mockMvc.perform(post("/api/people/" + personId + "/check-ins")
                .header("Authorization", bearer(token))
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(body)));
    }

    private Map<String, Object> entry(String note, Boolean visible) {
        Map<String, Object> body = new HashMap<>();
        body.put("note", note);
        if (visible != null) {
            body.put("visibleToPerson", visible);
        }
        return body;
    }

    private List<String> notesSeenBy(String token, long personId) throws Exception {
        List<String> notes = new ArrayList<>();
        json(mockMvc.perform(get("/api/people/" + personId + "/check-ins")
                        .header("Authorization", bearer(token)))
                .andExpect(status().isOk()))
                .forEach(row -> notes.add(row.get("note").asText()));
        return notes;
    }

    @Nested
    @DisplayName("a private observation")
    class PrivateObservation {

        // ⚠️ THE ASSERTION THIS WHOLE TABLE EXISTS FOR. If this ever goes green while broken, a
        // client reads what their trainer wrote about them and nothing anywhere looks wrong.
        @Test
        void isNeverVisibleToTheClientItIsAbout() throws Exception {
            addCheckIn(trainerToken, danaPersonId, entry("Knee still bothering her", false))
                    .andExpect(status().isOk());
            addCheckIn(trainerToken, danaPersonId, entry("Great session today", true))
                    .andExpect(status().isOk());

            String danaToken = memberTokenFor("Dana");

            assertThat(notesSeenBy(danaToken, danaPersonId))
                    .containsExactly("Great session today")
                    .doesNotContain("Knee still bothering her");
        }

        @Test
        void isVisibleToTheTrainerWhoWroteIt() throws Exception {
            addCheckIn(trainerToken, danaPersonId, entry("Knee still bothering her", false))
                    .andExpect(status().isOk());

            assertThat(notesSeenBy(trainerToken, danaPersonId))
                    .containsExactly("Knee still bothering her");
        }

        // ⚠️ WRITE_OTHER_PEOPLE, never VIEW_OTHER_PEOPLE. On a family account with visibility ON
        // every MEMBER holds VIEW_OTHER_PEOPLE, so gating on that would show a teenager whatever
        // their parent wrote privately about their sibling. This is the test that tells the two
        // permissions apart, and the difference is invisible from the names alone.
        @Test
        void isNotVisibleToASiblingWhoCanSeeEveryone() throws Exception {
            long samPersonId = json(mockMvc.perform(post("/api/people")
                    .header("Authorization", bearer(trainerToken))
                    .contentType(MediaType.APPLICATION_JSON)
                    .content(objectMapper.writeValueAsString(Map.of("name", "Sam")))))
                    .get("id").asLong();
            addCheckIn(trainerToken, danaPersonId, entry("Private about Dana", false))
                    .andExpect(status().isOk());

            // Sam is an ordinary member on an account whose members see everyone, so Sam CAN read
            // Dana's person. That must not extend to what was written privately about her.
            String samToken = memberTokenFor("Sam");

            assertThat(notesSeenBy(samToken, danaPersonId)).isEmpty();
        }
    }

    @Nested
    @DisplayName("a client writing their own")
    class ClientWriting {

        // A person cannot make an entry invisible to themselves: it is meaningless, and it would
        // create somewhere in the app their trainer can read but they cannot un-write.
        @Test
        void cannotHideItFromThemselves() throws Exception {
            String danaToken = memberTokenFor("Dana");

            addCheckIn(danaToken, danaPersonId, entry("Feeling strong", false))
                    .andExpect(status().isOk());

            // Forced visible rather than refused -- a durable write must not be discarded over a
            // field whose only correct value was already known.
            assertThat(notesSeenBy(danaToken, danaPersonId)).containsExactly("Feeling strong");
            assertThat(notesSeenBy(trainerToken, danaPersonId)).containsExactly("Feeling strong");
        }

        @Test
        void cannotWriteOnSomebodyElse() throws Exception {
            long samPersonId = json(mockMvc.perform(post("/api/people")
                    .header("Authorization", bearer(trainerToken))
                    .contentType(MediaType.APPLICATION_JSON)
                    .content(objectMapper.writeValueAsString(Map.of("name", "Sam")))))
                    .get("id").asLong();
            String danaToken = memberTokenFor("Dana");

            addCheckIn(danaToken, samPersonId, entry("Not mine to write", null))
                    .andExpect(status().isForbidden());
        }
    }

    @Nested
    @DisplayName("what cannot be saved")
    class CannotBeSaved {

        // ⚠️ A 400 rather than letting CK_check_ins_has_content produce a 500. A 500 is TRANSIENT to
        // shouldRetryWrite, so a durable write of nothing would retry forever and wedge the single
        // serial outbox scope -- taking every later write with it. Discarding an entry that records
        // nothing loses nothing.
        @Test
        void anEntryWithNeitherAWeightNorANote() throws Exception {
            addCheckIn(trainerToken, danaPersonId, entry(null, null))
                    .andExpect(status().isBadRequest());
            addCheckIn(trainerToken, danaPersonId, entry("   ", null))
                    .andExpect(status().isBadRequest());
        }
    }

    @Nested
    @DisplayName("deleting")
    class Deleting {

        @Test
        void aClientMayRemoveTheirOwnCheckIn() throws Exception {
            String danaToken = memberTokenFor("Dana");
            long id = json(addCheckIn(danaToken, danaPersonId, entry("Mine", null))).get("id").asLong();

            mockMvc.perform(delete("/api/people/" + danaPersonId + "/check-ins/" + id)
                            .header("Authorization", bearer(danaToken)))
                    .andExpect(status().isNoContent());

            assertThat(notesSeenBy(danaToken, danaPersonId)).isEmpty();
        }

        // 404 rather than 403: being refused differently would tell a client that a private entry
        // about them exists, which is the one thing the visibility flag is there to prevent.
        @Test
        void aClientMayNotRemoveWhatTheirTrainerWrote() throws Exception {
            long id = json(addCheckIn(trainerToken, danaPersonId, entry("Visible but the trainer's", true)))
                    .get("id").asLong();
            String danaToken = memberTokenFor("Dana");

            mockMvc.perform(delete("/api/people/" + danaPersonId + "/check-ins/" + id)
                            .header("Authorization", bearer(danaToken)))
                    .andExpect(status().isNotFound());

            assertThat(notesSeenBy(trainerToken, danaPersonId)).containsExactly("Visible but the trainer's");
        }
    }
}
