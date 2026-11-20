package com.worktrac.backend.membership;

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

import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Member logins are a Plus feature, and dropping to Free PAUSES them.
 *
 * <p>⚠️ <b>A pause, not a punishment.</b> Nothing is deleted, no membership is revoked, and no
 * queued write is discarded. The member's person, history and PRs stay exactly where they are and
 * the owner still sees all of it; when the household is Plus again the login resumes on its own.
 * Every test here is really an assertion about that distinction.
 *
 * <p>⚠️ <b>Do not reuse billing.md's line "a plan decides what a screen SHOWS, never what exists".
 * </b> That was written about DATA, and it stays true — no workout is hidden or deleted here. But a
 * plan genuinely does decide what a LOGIN can do, which is a different claim, and conflating the
 * two would make one of them false.
 */
@AutoConfigureMockMvc
@DisplayName("a member login when the household is not Plus")
class MemberLoginPauseTest extends AbstractIntegrationTest {

    private static final String TEST_KEY = "local-dev-only-e2e-test-key-do-not-use-elsewhere";

    @DynamicPropertySource
    static void datasource(DynamicPropertyRegistry registry) {
        registerDatasource(registry, MemberLoginPauseTest.class);
    }

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private TestCodeCache testCodeCache;

    @MockitoBean
    private EmailService emailService;

    private final ObjectMapper objectMapper = new ObjectMapper();

    private String ownerEmail;
    private String ownerToken;
    private String memberToken;
    private long memberPersonId;
    private long ownerPersonId;

    @BeforeEach
    void setUpPlusHouseholdWithAMember() throws Exception {
        String suffix = UUID.randomUUID().toString().substring(0, 8);
        ownerEmail = "owner-" + suffix + "@example.com";
        String memberEmail = "member-" + suffix + "@example.com";

        JsonNode ownerRegistration = RegistrationTestSupport
                .registerAndConfirm(mockMvc, objectMapper, testCodeCache, ownerEmail, "Nate");
        ownerToken = ownerRegistration.get("token").asText();
        ownerPersonId = ownerRegistration.get("person").get("id").asLong();

        setPlan("PLUS");

        memberPersonId = json(mockMvc.perform(post("/api/people")
                .header("Authorization", bearer(ownerToken))
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(Map.of("name", "Sam")))))
                .get("id").asLong();

        mockMvc.perform(post("/api/auth/test/member")
                        .header("X-E2E-Test-Key", TEST_KEY)
                        .param("ownerEmail", ownerEmail)
                        .param("personName", "Sam")
                        .param("memberEmail", memberEmail)
                        .param("password", "password123"))
                .andExpect(status().isNoContent());

        memberToken = json(mockMvc.perform(post("/api/auth/login")
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(
                        Map.of("email", memberEmail, "password", "password123")))))
                .get("token").asText();
    }

    private void setPlan(String plan) throws Exception {
        mockMvc.perform(post("/api/auth/test/billing-plan")
                        .header("X-E2E-Test-Key", TEST_KEY)
                        .param("email", ownerEmail)
                        .param("plan", plan))
                .andExpect(status().isNoContent());
    }

    private String bearer(String token) {
        return "Bearer " + token;
    }

    private JsonNode json(ResultActions actions) throws Exception {
        return objectMapper.readTree(actions.andReturn().getResponse().getContentAsString());
    }

    private ResultActions logASet(String token) throws Exception {
        return mockMvc.perform(post("/api/people/" + memberPersonId + "/live-sets")
                .header("Authorization", bearer(token))
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(Map.of(
                        "exerciseId", 1, "weight", 100, "reps", 5, "clientKey", UUID.randomUUID().toString()))));
    }

    @Nested
    @DisplayName("while paused")
    class WhilePaused {

        @BeforeEach
        void downgrade() throws Exception {
            setPlan("FREE");
        }

        @Test
        void theMemberCannotWriteAnything() throws Exception {
            logASet(memberToken).andExpect(status().isForbidden());
        }

        /**
         * ⚠️ <b>/me is the single authority, and it must keep answering 200.</b> The client renders
         * the paused screen from {@code membership.status}. If /me 403'd too, the client would have
         * to infer being paused from a failure — and it cannot tell a refusal from a briefly
         * unhappy backend by status alone. Guessing wrong there is the signed-out failure
         * {@code docs/incidents/2026-07-27-db-outage-forced-logout.md} describes.
         */
        @Test
        void meStillAnswersAndSaysWhy() throws Exception {
            JsonNode me = json(mockMvc.perform(get("/api/auth/me").header("Authorization", bearer(memberToken)))
                    .andExpect(status().isOk()));

            assertThat(me.get("membership").get("status").asText()).isEqualTo("PAUSED_PLAN");
        }

        // So the paused screen can say what plan the household is actually on. Without it the
        // screen can state the problem but never confirm it has been fixed.
        @Test
        void theSubscriptionIsStillReadable() throws Exception {
            mockMvc.perform(get("/api/billing/subscription").header("Authorization", bearer(memberToken)))
                    .andExpect(status().isOk());
        }

        // Everything else, including plain reads. A pause is "you may not use this login", not
        // "you may look but not touch".
        @Test
        void everyOtherRouteIsRefused() throws Exception {
            mockMvc.perform(get("/api/people/" + memberPersonId + "/history")
                            .header("Authorization", bearer(memberToken)))
                    .andExpect(status().isForbidden());
            mockMvc.perform(get("/api/exercises").header("Authorization", bearer(memberToken)))
                    .andExpect(status().isForbidden());
        }

        /**
         * ⚠️ A paused member can still take their OWN training out. Export is free on every tier
         * (coaching.md), and somebody whose login stopped working through no fault of theirs is
         * exactly who needs it -- the paused screen's Download button calls this.
         */
        @Test
        void aPausedMemberCanStillDownloadTheirOwnData() throws Exception {
            mockMvc.perform(get("/api/people/" + memberPersonId + "/export.csv")
                            .header("Authorization", bearer(memberToken)))
                    .andExpect(status().isOk())
                    .andExpect(header().string("Content-Type", org.hamcrest.Matchers.startsWith("text/csv")));
        }

        /**
         * ...and ONLY their own. On a family account a member can normally SEE their siblings, so
         * an export exemption keyed on "visible" would hand a paused login everybody's history; the
         * household zip is owner-only even unpaused. Both stay refused with the pause's own code.
         */
        @Test
        void butNotAnybodyElsesNorTheWholeHousehold() throws Exception {
            JsonNode sibling = json(mockMvc.perform(get("/api/people/" + ownerPersonId + "/export.csv")
                            .header("Authorization", bearer(memberToken)))
                    .andExpect(status().isForbidden()));
            assertThat(sibling.get("code").asText()).isEqualTo("MEMBER_LOGIN_PAUSED");

            mockMvc.perform(get("/api/export/all.zip").header("Authorization", bearer(memberToken)))
                    .andExpect(status().isForbidden());
        }

        /**
         * ⚠️ The refusal carries a CODE, and that is what stops the client discarding queued work.
         *
         * <p>A 403 is normally definitive, so {@code isDeadWrite} reports the write as one that can
         * never land. This 403 is the opposite — the household re-upgrades and the write lands by
         * itself. Without something machine-readable, a paused member would be told their sets are
         * lost when they are not.
         */
        @Test
        void theRefusalIsMachineReadableSoQueuedWorkIsNotDeclaredDead() throws Exception {
            JsonNode error = json(logASet(memberToken).andExpect(status().isForbidden()));

            assertThat(error.get("code").asText()).isEqualTo("MEMBER_LOGIN_PAUSED");
            // ...and it says what happened in words a person can act on, not just a code.
            assertThat(error.get("message").asText())
                    .contains("paused")
                    .contains("Nothing has been deleted");
        }

        /** The owner is never paused — they are the only one who can undo it. */
        @Test
        void theOwnerIsUntouched() throws Exception {
            mockMvc.perform(get("/api/auth/me").header("Authorization", bearer(ownerToken)))
                    .andExpect(status().isOk());
            logASet(ownerToken).andExpect(status().isOk());
        }

        /**
         * ⚠️ THE PERSON, THEIR DATA AND THEIR MEMBERSHIP ALL SURVIVE. This is what makes it a pause
         * rather than a revocation: nothing has to be re-invited, re-created or restored on the way
         * back to Plus.
         */
        @Test
        void theMembershipItselfIsNotRevoked() throws Exception {
            JsonNode logins = json(mockMvc.perform(get("/api/account/logins")
                    .header("Authorization", bearer(ownerToken))));
            JsonNode sam = logins.get(0).get("personId").asLong() == memberPersonId
                    ? logins.get(0) : logins.get(1);

            assertThat(sam.get("status").asText()).isEqualTo("ACTIVE");
        }
    }

    @Nested
    @DisplayName("coming back")
    class ComingBack {

        /**
         * ⚠️ <b>The re-upgrade must take effect NOW, not within the cache TTL.</b> Somebody who has
         * just paid staring at "your login is paused" for another minute has no way to tell whether
         * the payment worked, and that is exactly when they give up or contact support.
         *
         * <p>This is what {@code AccountPlanChangedListener} exists for. Remove it and this test
         * fails while every other test in the class still passes, because the rest never re-read a
         * plan the cache has already answered for.
         */
        @Test
        void resumingPlusUnpausesTheLoginImmediately() throws Exception {
            setPlan("FREE");
            logASet(memberToken).andExpect(status().isForbidden());

            setPlan("PLUS");

            logASet(memberToken).andExpect(status().isOk());
            JsonNode me = json(mockMvc.perform(get("/api/auth/me").header("Authorization", bearer(memberToken))));
            assertThat(me.get("membership").get("status").asText()).isEqualTo("ACTIVE");
        }

        // Signing in fresh while paused must still WORK -- it is how somebody reaches the screen
        // that explains the situation. The pause is about what the session may do, not about
        // whether one can be obtained.
        @Test
        void aPausedMemberCanStillSignIn() throws Exception {
            setPlan("FREE");
            String suffix = ownerEmail.substring(6, 14);

            JsonNode session = json(mockMvc.perform(post("/api/auth/login")
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(objectMapper.writeValueAsString(Map.of(
                                    "email", "member-" + suffix + "@example.com",
                                    "password", "password123"))))
                    .andExpect(status().isOk()));

            assertThat(session.get("token").asText()).isNotBlank();
            assertThat(session.get("membership").get("status").asText()).isEqualTo("PAUSED_PLAN");
        }
    }
}
