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
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

// The counterpart to MultiTenancyIsolationTest, one boundary in: that one proves another HOUSEHOLD
// cannot touch your rows, this proves another PERSON IN YOUR OWN HOUSEHOLD cannot.
//
// That distinction is the whole feature. Every route below was previously reachable by anyone
// holding the household's single login, so "it worked before" is not evidence of anything here.
@AutoConfigureMockMvc
class MemberPermissionsTest extends AbstractIntegrationTest {

    @DynamicPropertySource
    static void datasource(DynamicPropertyRegistry registry) {
        registerDatasource(registry, MemberPermissionsTest.class);
    }

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private TestCodeCache testCodeCache;

    @Autowired
    private JdbcTemplate jdbc;

    @Autowired
    private AccountAccessService accountAccessService;

    @MockitoBean
    private EmailService emailService;

    private final ObjectMapper objectMapper = new ObjectMapper();

    private String ownerToken;
    private String memberToken;
    private long ownerPersonId;
    private long memberPersonId;
    private long accountId;

    @BeforeEach
    void setUpHouseholdWithAMember() throws Exception {
        String suffix = UUID.randomUUID().toString().substring(0, 8);
        String ownerEmail = "owner-" + suffix + "@example.com";
        String memberEmail = "member-" + suffix + "@example.com";

        ownerToken = RegistrationTestSupport
                .registerAndConfirm(mockMvc, objectMapper, testCodeCache, ownerEmail, "Nate")
                .get("token").asText();

        JsonNode me = json(mockMvc.perform(get("/api/auth/me").header("Authorization", bearer(ownerToken)))
                .andExpect(status().isOk()));
        ownerPersonId = me.get("people").get(0).get("id").asLong();
        accountId = me.get("account").get("id").asLong();

        // A second person, then a MEMBER login bound to them -- the shape phase 7's invite flow
        // will produce, built here directly because that flow does not exist yet.
        memberPersonId = json(mockMvc.perform(post("/api/people")
                .header("Authorization", bearer(ownerToken))
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(Map.of("name", "Sam")))))
                .get("id").asLong();

        mockMvc.perform(post("/api/auth/test/member")
                        .header("X-E2E-Test-Key", "local-dev-only-e2e-test-key-do-not-use-elsewhere")
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

    private String bearer(String token) {
        return "Bearer " + token;
    }

    private JsonNode json(org.springframework.test.web.servlet.ResultActions actions) throws Exception {
        return objectMapper.readTree(actions.andReturn().getResponse().getContentAsString());
    }

    private void setVisibility(boolean membersSeeEveryone) {
        jdbc.update("UPDATE accounts SET members_see_everyone = ? WHERE id = ?",
                membersSeeEveryone ? 1 : 0, accountId);
        accountAccessService.invalidateAccount(accountId);
    }

    @Nested
    @DisplayName("the member's own data")
    class OwnData {

        @Test
        void canBeReadAndWritten() throws Exception {
            mockMvc.perform(get("/api/people/" + memberPersonId + "/history")
                            .header("Authorization", bearer(memberToken)))
                    .andExpect(status().isOk());
            mockMvc.perform(put("/api/people/" + memberPersonId + "/rest-timer-preference")
                            .header("Authorization", bearer(memberToken))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(objectMapper.writeValueAsString(Map.of("enabled", false))))
                    .andExpect(status().isOk());
        }

        // A member renaming THEMSELVES is deliberately allowed -- it is their own name, and the
        // guard distinguishes that from renaming someone else without the controller knowing which
        // case it is.
        @Test
        void canBeRenamedByTheMember() throws Exception {
            mockMvc.perform(patch("/api/people/" + memberPersonId)
                            .header("Authorization", bearer(memberToken))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(objectMapper.writeValueAsString(Map.of("name", "Samuel"))))
                    .andExpect(status().isOk());
        }
    }

    @Nested
    @DisplayName("another person in the same household, with visibility ON")
    class SiblingVisible {

        @Test
        void canBeRead() throws Exception {
            mockMvc.perform(get("/api/people/" + ownerPersonId + "/history")
                            .header("Authorization", bearer(memberToken)))
                    .andExpect(status().isOk());
        }

        // ⚠️ THE ONE THAT MATTERS. 403 rather than 404, because with visibility on the member is
        // looking at that person's name on screen -- a "doesn't exist" would be a lie the UI
        // immediately contradicts.
        @Test
        void cannotBeWrittenThroughThePersonIdRoutes() throws Exception {
            mockMvc.perform(post("/api/people/" + ownerPersonId + "/live-sets")
                            .header("Authorization", bearer(memberToken))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(objectMapper.writeValueAsString(
                                    Map.of("exerciseId", 1, "weight", 100, "reps", 5))))
                    .andExpect(status().isForbidden());

            mockMvc.perform(put("/api/people/" + ownerPersonId + "/rest-timer-preference")
                            .header("Authorization", bearer(memberToken))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(objectMapper.writeValueAsString(Map.of("enabled", false))))
                    .andExpect(status().isForbidden());

            mockMvc.perform(patch("/api/people/" + ownerPersonId)
                            .header("Authorization", bearer(memberToken))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(objectMapper.writeValueAsString(Map.of("name", "Hacked"))))
                    .andExpect(status().isForbidden());
        }

        // ⚠️ THE HOLE THIS FEATURE MOST LIKELY SHIPS WITH. These routes carry no personId at all --
        // they prove tenancy by walking the FK chain up to the ACCOUNT, which the member genuinely
        // belongs to. Locking down every {personId} route and stopping there leaves this wide open.
        @Test
        void cannotBeWrittenThroughTheChildIdRoutes() throws Exception {
            long sessionId = json(mockMvc.perform(post("/api/people/" + ownerPersonId + "/sessions")
                    .header("Authorization", bearer(ownerToken))
                    .contentType(MediaType.APPLICATION_JSON)
                    .content(objectMapper.writeValueAsString(Map.of("startedAt", "2026-01-01T10:00:00Z")))))
                    .get("id").asLong();

            mockMvc.perform(patch("/api/sessions/" + sessionId)
                            .header("Authorization", bearer(memberToken))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(objectMapper.writeValueAsString(
                                    Map.of("startedAt", "2020-01-01T10:00:00Z"))))
                    .andExpect(status().isForbidden());

            mockMvc.perform(post("/api/sessions/" + sessionId + "/sets")
                            .header("Authorization", bearer(memberToken))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(objectMapper.writeValueAsString(
                                    Map.of("exerciseId", 1, "weight", 100, "reps", 5))))
                    .andExpect(status().isForbidden());

            // The read counterpart stays allowed while visibility is on.
            mockMvc.perform(get("/api/sessions/" + sessionId + "/sets?exerciseId=1")
                            .header("Authorization", bearer(memberToken)))
                    .andExpect(status().isOk());
        }
    }

    @Nested
    @DisplayName("another person, with visibility OFF (the Team-tier seam)")
    class SiblingHidden {

        // 404, not 403: a member who cannot see a person must not learn that they exist.
        @Test
        void isInvisibleRatherThanForbidden() throws Exception {
            setVisibility(false);

            mockMvc.perform(get("/api/people/" + ownerPersonId + "/history")
                            .header("Authorization", bearer(memberToken)))
                    .andExpect(status().isNotFound());
            mockMvc.perform(patch("/api/people/" + ownerPersonId)
                            .header("Authorization", bearer(memberToken))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(objectMapper.writeValueAsString(Map.of("name", "Hacked"))))
                    .andExpect(status().isNotFound());
        }

        @Test
        void isNotEvenListed() throws Exception {
            setVisibility(false);

            JsonNode people = json(mockMvc.perform(get("/api/auth/me")
                    .header("Authorization", bearer(memberToken)))).get("people");

            assertThat(people).hasSize(1);
            assertThat(people.get(0).get("id").asLong()).isEqualTo(memberPersonId);
        }
    }

    @Nested
    @DisplayName("household-wide actions")
    class HouseholdWide {

        @Test
        void areRefusedForAMember() throws Exception {
            mockMvc.perform(post("/api/people")
                            .header("Authorization", bearer(memberToken))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(objectMapper.writeValueAsString(Map.of("name", "Sneaky"))))
                    .andExpect(status().isForbidden());

            mockMvc.perform(delete("/api/people/" + ownerPersonId)
                            .header("Authorization", bearer(memberToken)))
                    .andExpect(status().isForbidden());

            mockMvc.perform(put("/api/account/default-unit")
                            .header("Authorization", bearer(memberToken))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(objectMapper.writeValueAsString(Map.of("defaultUnit", "kg"))))
                    .andExpect(status().isForbidden());

            // The whole household in one file. Deliberately NOT the same permission as reading one
            // person's export.csv -- otherwise "members can see everyone" quietly becomes "any
            // member can walk out with the household's complete training history in one click".
            mockMvc.perform(get("/api/export/all.zip").header("Authorization", bearer(memberToken)))
                    .andExpect(status().isForbidden());
        }

        // Creating a custom exercise must stay open to members: it is a durable offline write, and
        // a 403 on one of those is terminal -- it would discard the create AND every set queued
        // behind its temp id.
        @Test
        void butCreatingASharedExerciseIsStillAllowed() throws Exception {
            mockMvc.perform(post("/api/exercises")
                            .header("Authorization", bearer(memberToken))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(objectMapper.writeValueAsString(
                                    Map.of("name", "Member's Lift " + UUID.randomUUID(),
                                            "trackingType", "strength"))))
                    .andExpect(status().isOk());
        }
    }

    @Nested
    @DisplayName("the owner")
    class Owner {

        @Test
        void keepsFullAccessToEveryone() throws Exception {
            mockMvc.perform(get("/api/people/" + memberPersonId + "/history")
                            .header("Authorization", bearer(ownerToken)))
                    .andExpect(status().isOk());
            mockMvc.perform(patch("/api/people/" + memberPersonId)
                            .header("Authorization", bearer(ownerToken))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(objectMapper.writeValueAsString(Map.of("name", "Sam"))))
                    .andExpect(status().isOk());
            mockMvc.perform(get("/api/export/all.zip").header("Authorization", bearer(ownerToken)))
                    .andExpect(status().isOk());
        }

        // The shared-iPad flow, which member logins must never regress: the owner still sees the
        // whole household regardless of the visibility setting.
        @Test
        void stillSeesEveryoneWithVisibilityOff() throws Exception {
            setVisibility(false);

            JsonNode people = json(mockMvc.perform(get("/api/auth/me")
                    .header("Authorization", bearer(ownerToken)))).get("people");

            assertThat(people).hasSize(2);
        }
    }
}
