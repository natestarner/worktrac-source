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
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

// A "trusted" login: AccountRole.MANAGER made assignable by the owner on Plus (and Pro), so a second
// adult can share the iPad and log for herself AND the kids -- but never over the owner's own sets.
//
// The household here: Nate (owner), Sam (a member login, the one made trusted), Leo (a kid with no
// login). Every write below goes through the real endpoints, so a guard that is wired wrong shows up
// as a status, not as a unit-test assumption.
@AutoConfigureMockMvc
class TrustedLoginTest extends AbstractIntegrationTest {

    private static final String TEST_KEY = "local-dev-only-e2e-test-key-do-not-use-elsewhere";

    @DynamicPropertySource
    static void datasource(DynamicPropertyRegistry registry) {
        registerDatasource(registry, TrustedLoginTest.class);
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
    private String samToken;
    private long ownerPersonId;
    private long samPersonId;
    private long leoPersonId;
    private long accountId;

    @BeforeEach
    void setUpHousehold() throws Exception {
        String suffix = UUID.randomUUID().toString().substring(0, 8);
        ownerEmail = "owner-" + suffix + "@example.com";

        ownerToken = RegistrationTestSupport
                .registerAndConfirm(mockMvc, objectMapper, testCodeCache, ownerEmail, "Nate")
                .get("token").asText();
        JsonNode me = json(mockMvc.perform(get("/api/auth/me").header("Authorization", bearer(ownerToken)))
                .andExpect(status().isOk()));
        ownerPersonId = me.get("people").get(0).get("id").asLong();
        accountId = me.get("account").get("id").asLong();

        // Plus FIRST -- member logins (and now trusted ones) are paid; on Free every member request
        // would test the pause instead. See member-access.md.
        setPlan("PLUS");

        samPersonId = addPerson("Sam");
        leoPersonId = addPerson("Leo");
        samToken = memberLogin("Sam", "sam-" + suffix + "@example.com");
    }

    // ── helpers ─────────────────────────────────────────────────────────────────────────────────

    private String bearer(String token) {
        return "Bearer " + token;
    }

    private JsonNode json(ResultActions actions) throws Exception {
        return objectMapper.readTree(actions.andReturn().getResponse().getContentAsString());
    }

    private void setPlan(String plan) throws Exception {
        mockMvc.perform(post("/api/auth/test/billing-plan")
                        .header("X-E2E-Test-Key", TEST_KEY)
                        .param("email", ownerEmail)
                        .param("plan", plan))
                .andExpect(status().isNoContent());
    }

    private long addPerson(String name) throws Exception {
        return json(mockMvc.perform(post("/api/people")
                        .header("Authorization", bearer(ownerToken))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of("name", name))))
                .andExpect(status().isOk()))
                .get("id").asLong();
    }

    private String memberLogin(String personName, String email) throws Exception {
        mockMvc.perform(post("/api/auth/test/member")
                        .header("X-E2E-Test-Key", TEST_KEY)
                        .param("ownerEmail", ownerEmail)
                        .param("personName", personName)
                        .param("memberEmail", email)
                        .param("password", "password123"))
                .andExpect(status().isNoContent());
        return json(mockMvc.perform(post("/api/auth/login")
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(Map.of("email", email, "password", "password123")))))
                .get("token").asText();
    }

    private ResultActions setRole(String token, long personId, String role) throws Exception {
        return mockMvc.perform(put("/api/account/logins/" + personId + "/role")
                .header("Authorization", bearer(token))
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(Map.of("role", role))));
    }

    private void trustSam() throws Exception {
        setRole(ownerToken, samPersonId, "MANAGER").andExpect(status().isOk());
    }

    private ResultActions restTimer(String token, long personId) throws Exception {
        return mockMvc.perform(put("/api/people/" + personId + "/rest-timer-preference")
                .header("Authorization", bearer(token))
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(Map.of("enabled", false))));
    }

    private long createExercise(String token, String name) throws Exception {
        return json(mockMvc.perform(post("/api/exercises")
                .header("Authorization", bearer(token))
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(Map.of("name", name)))))
                .get("id").asLong();
    }

    private ResultActions logSet(String token, long personId, long exerciseId) throws Exception {
        return mockMvc.perform(post("/api/people/" + personId + "/live-sets")
                .header("Authorization", bearer(token))
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(Map.of("exerciseId", exerciseId, "weight", 100, "reps", 5))));
    }

    private JsonNode loginRow(String token, long personId) throws Exception {
        JsonNode rows = json(mockMvc.perform(get("/api/account/logins").header("Authorization", bearer(token)))
                .andExpect(status().isOk()));
        for (JsonNode row : rows) {
            if (row.get("personId").asLong() == personId) {
                return row;
            }
        }
        throw new AssertionError("No login row for person " + personId);
    }

    // ── tests ───────────────────────────────────────────────────────────────────────────────────

    @Nested
    @DisplayName("making a login trusted")
    class Promoting {

        @Test
        void theOwnerCanTrustAMemberAndItTakesEffectOnTheNextRequest() throws Exception {
            JsonNode row = json(setRole(ownerToken, samPersonId, "MANAGER").andExpect(status().isOk()));
            assertThat(row.get("role").asText()).isEqualTo("MANAGER");
            assertThat(row.get("status").asText()).isEqualTo("ACTIVE");
            assertThat(loginRow(ownerToken, samPersonId).get("role").asText()).isEqualTo("MANAGER");

            // No re-login: the access cache was invalidated per membership, so Sam's existing token
            // now carries the new role.
            JsonNode membership = json(mockMvc.perform(get("/api/auth/me").header("Authorization", bearer(samToken)))
                    .andExpect(status().isOk())).get("membership");
            assertThat(membership.get("accountRole").asText()).isEqualTo("MANAGER");
            assertThat(membership.get("ownerPersonId").asLong()).isEqualTo(ownerPersonId);
            assertThat(membership.get("ownerName").asText()).isEqualTo("Nate");
        }

        // The owner is told nothing about themselves: the fields answer a non-owner's questions.
        @Test
        void theOwnersOwnMeCarriesNoOwnerFields() throws Exception {
            JsonNode membership = json(mockMvc.perform(get("/api/auth/me").header("Authorization", bearer(ownerToken)))
                    .andExpect(status().isOk())).get("membership");
            assertThat(membership.get("ownerPersonId").isNull()).isTrue();
            assertThat(membership.get("ownerName").isNull()).isTrue();
        }

        @Test
        void aPlainMemberIsToldWhoTheOwnerIsToo() throws Exception {
            JsonNode membership = json(mockMvc.perform(get("/api/auth/me").header("Authorization", bearer(samToken)))
                    .andExpect(status().isOk())).get("membership");
            assertThat(membership.get("accountRole").asText()).isEqualTo("MEMBER");
            assertThat(membership.get("ownerPersonId").asLong()).isEqualTo(ownerPersonId);
        }

        @Test
        void isIdempotent() throws Exception {
            trustSam();
            JsonNode again = json(setRole(ownerToken, samPersonId, "MANAGER").andExpect(status().isOk()));
            assertThat(again.get("role").asText()).isEqualTo("MANAGER");
        }

        @Test
        void needsALoginToTrust() throws Exception {
            setRole(ownerToken, leoPersonId, "MANAGER").andExpect(status().isConflict());
        }

        @Test
        void neverChangesTheOwnersOwnLogin() throws Exception {
            setRole(ownerToken, ownerPersonId, "MEMBER").andExpect(status().isConflict());
            setRole(ownerToken, ownerPersonId, "MANAGER").andExpect(status().isConflict());
        }

        // There is no way to make a second owner here, and an unknown value is malformed.
        @Test
        void acceptsOnlyManagerOrMember() throws Exception {
            setRole(ownerToken, samPersonId, "OWNER").andExpect(status().isBadRequest());
            setRole(ownerToken, samPersonId, "ADMIN").andExpect(status().isBadRequest());
        }

        @Test
        void isAPaidFeatureToGrantButNeverToTakeAway() throws Exception {
            trustSam();
            setPlan("FREE");

            // Taking access away must work on any plan.
            JsonNode demoted = json(setRole(ownerToken, samPersonId, "MEMBER").andExpect(status().isOk()));
            assertThat(demoted.get("role").asText()).isEqualTo("MEMBER");

            setRole(ownerToken, samPersonId, "MANAGER").andExpect(status().isConflict());
        }

        @Test
        void aPersonInAnotherHouseholdIsNotFound() throws Exception {
            setRole(ownerToken, 987_654_321L, "MANAGER").andExpect(status().isNotFound());
        }
    }

    @Nested
    @DisplayName("who may change it")
    class WhoMayChangeIt {

        @Test
        void aMemberCannot() throws Exception {
            setRole(samToken, samPersonId, "MANAGER").andExpect(status().isForbidden());
        }

        // A trusted login holds MANAGE_LOGINS but not ASSIGN_ROLES: it can never crown somebody else
        // or undo the owner's decision about itself.
        @Test
        void aTrustedLoginCannot() throws Exception {
            trustSam();
            setRole(samToken, samPersonId, "MEMBER").andExpect(status().isForbidden());
        }

        @Test
        void aTrustedLoginCannotRemoveAnotherTrustedLogin() throws Exception {
            trustSam();
            String suffix = UUID.randomUUID().toString().substring(0, 8);
            long maePersonId = addPerson("Mae");
            memberLogin("Mae", "mae-" + suffix + "@example.com");
            setRole(ownerToken, maePersonId, "MANAGER").andExpect(status().isOk());

            mockMvc.perform(delete("/api/account/logins/" + maePersonId)
                            .header("Authorization", bearer(samToken)))
                    .andExpect(status().isForbidden());
            assertThat(loginRow(ownerToken, maePersonId).get("status").asText()).isEqualTo("ACTIVE");

            // ...and the owner still can.
            mockMvc.perform(delete("/api/account/logins/" + maePersonId)
                            .header("Authorization", bearer(ownerToken)))
                    .andExpect(status().isNoContent());
        }
    }

    @Nested
    @DisplayName("what a trusted login can do")
    class WhatTrustedCanDo {

        @Test
        void logsForThemselvesAndForSomeoneWithoutALogin() throws Exception {
            trustSam();
            long exerciseId = createExercise(ownerToken, "Goblet Squat");

            logSet(samToken, samPersonId, exerciseId).andExpect(status().isOk());
            logSet(samToken, leoPersonId, exerciseId).andExpect(status().isOk());
            restTimer(samToken, leoPersonId).andExpect(status().isOk());
        }

        @Test
        void canAddAndRenameSomeoneElse() throws Exception {
            trustSam();
            mockMvc.perform(post("/api/people")
                            .header("Authorization", bearer(samToken))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(objectMapper.writeValueAsString(Map.of("name", "Max"))))
                    .andExpect(status().isOk());
            mockMvc.perform(patch("/api/people/" + leoPersonId)
                            .header("Authorization", bearer(samToken))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(objectMapper.writeValueAsString(Map.of("name", "Leon"))))
                    .andExpect(status().isOk());
        }

        // Before trusting, the same writes are refused -- so the tests above prove the role, not
        // a guard that lets everyone through.
        @Test
        void aPlainMemberCannotDoTheSame() throws Exception {
            long exerciseId = createExercise(ownerToken, "Goblet Squat");
            logSet(samToken, leoPersonId, exerciseId).andExpect(status().isForbidden());
            restTimer(samToken, leoPersonId).andExpect(status().isForbidden());
        }

        @Test
        void demotingTakesItAwayAgain() throws Exception {
            trustSam();
            restTimer(samToken, leoPersonId).andExpect(status().isOk());
            setRole(ownerToken, samPersonId, "MEMBER").andExpect(status().isOk());
            restTimer(samToken, leoPersonId).andExpect(status().isForbidden());
        }
    }

    @Nested
    @DisplayName("what stays the owner's")
    class WhatStaysTheOwners {

        @Test
        void theOwnersOwnLogAndSettingsAreReadOnly() throws Exception {
            trustSam();
            long exerciseId = createExercise(ownerToken, "Goblet Squat");

            logSet(samToken, ownerPersonId, exerciseId).andExpect(status().isForbidden());
            restTimer(samToken, ownerPersonId).andExpect(status().isForbidden());
            mockMvc.perform(patch("/api/people/" + ownerPersonId)
                            .header("Authorization", bearer(samToken))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(objectMapper.writeValueAsString(Map.of("name", "Not Nate"))))
                    .andExpect(status().isForbidden());

            // ...but still visible.
            mockMvc.perform(get("/api/people/" + ownerPersonId + "/history")
                            .header("Authorization", bearer(samToken)))
                    .andExpect(status().isOk());
        }

        // A set the owner logged cannot be edited or deleted by a trusted login either -- the
        // child-id endpoints go through the same guard.
        @Test
        void theOwnersExistingSetsCannotBeEditedOrDeleted() throws Exception {
            trustSam();
            long exerciseId = createExercise(ownerToken, "Goblet Squat");
            long setId = json(logSet(ownerToken, ownerPersonId, exerciseId).andExpect(status().isOk()))
                    .get("set").get("id").asLong();

            mockMvc.perform(delete("/api/sets/" + setId).header("Authorization", bearer(samToken)))
                    .andExpect(status().isForbidden());
        }

        @Test
        void removingAPersonIsTheOwnersAlone() throws Exception {
            trustSam();
            mockMvc.perform(delete("/api/people/" + leoPersonId).header("Authorization", bearer(samToken)))
                    .andExpect(status().isForbidden());
            mockMvc.perform(delete("/api/people/" + leoPersonId).header("Authorization", bearer(ownerToken)))
                    .andExpect(status().isNoContent());
        }

        @Test
        void accountLevelControlsStayTheOwners() throws Exception {
            trustSam();
            mockMvc.perform(delete("/api/account")
                            .header("Authorization", bearer(samToken))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(objectMapper.writeValueAsString(Map.of("password", "password123"))))
                    .andExpect(status().isForbidden());
        }
    }
}
