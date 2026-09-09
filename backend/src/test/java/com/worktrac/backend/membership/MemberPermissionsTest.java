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

        // ⚠️ Pro FIRST. Member logins are a Pro feature, so from phase 8 a member in a Free
        // household is PAUSED and every request below would 403 before reaching the check it is
        // actually about. Registration creates a Free subscription, so without this line the whole
        // class tests the pause instead of what it says it tests.
        mockMvc.perform(post("/api/auth/test/billing-plan")
                        .header("X-E2E-Test-Key", "local-dev-only-e2e-test-key-do-not-use-elsewhere")
                        .param("email", ownerEmail)
                        .param("plan", "PRO"))
                .andExpect(status().isNoContent());

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

    // ⚠️ THE HIGHEST-RISK SURFACE IN PHASE 5, and the only thing testing it is this class.
    //
    // PUT /api/exercises/{id} and PUT /api/tags/{id} used to require EDIT_ANY_SHARED_RESOURCE,
    // which is owner-only, so the interceptor refused every member before any handler ran. They now
    // require EDIT_OWN_SHARED_RESOURCE, which EVERY member holds -- the interceptor admits them on
    // purpose, because it cannot know who created the row behind an {id}, and the service's
    // AccountAccess.mayEditSharedResource is what actually refuses.
    //
    // HandlerPermissionCoverageTest cannot catch that check being dropped: it asserts an annotation
    // is PRESENT, never WHICH one. So if the checks below are ever deleted, nothing else fails --
    // the endpoints simply start letting every member rename the whole household's catalog.
    @Nested
    @DisplayName("shared resources (exercises and tags)")
    class SharedResources {

        private long createExerciseAs(String token, String name) throws Exception {
            return json(mockMvc.perform(post("/api/exercises")
                    .header("Authorization", bearer(token))
                    .contentType(MediaType.APPLICATION_JSON)
                    .content(objectMapper.writeValueAsString(Map.of("name", name)))))
                    .get("id").asLong();
        }

        private long createTagAs(String token, String name) throws Exception {
            return json(mockMvc.perform(post("/api/tags")
                    .header("Authorization", bearer(token))
                    .contentType(MediaType.APPLICATION_JSON)
                    .content(objectMapper.writeValueAsString(Map.of("name", name)))))
                    .get("id").asLong();
        }

        // A member MUST be able to create. It is a durable offline write, and shouldRetryWrite
        // treats a definitive 4xx as terminal -- so a 403 here would not merely refuse the
        // exercise, it would discard it permanently along with every set already queued behind its
        // temp id. See ExerciseService.add.
        @Test
        void aMemberMayCreateAnExerciseAndATag() throws Exception {
            assertThat(createExerciseAs(memberToken, "Sam's Curl")).isPositive();
            assertThat(createTagAs(memberToken, "sam-pull")).isPositive();
        }

        @Test
        void aMemberMayRenameTheExerciseTheyCreated() throws Exception {
            long id = createExerciseAs(memberToken, "Sam's Curl");

            mockMvc.perform(put("/api/exercises/" + id)
                            .header("Authorization", bearer(memberToken))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(objectMapper.writeValueAsString(Map.of("name", "Sam's EZ Curl"))))
                    .andExpect(status().isOk());
        }

        // The one that matters. 403 rather than 404 on purpose: the exercise IS visible to them --
        // it is in the shared catalog they search every day -- so pretending it does not exist is a
        // lie the picker contradicts on the same screen.
        @Test
        void aMemberMayNotRenameSomebodyElsesExercise() throws Exception {
            long id = createExerciseAs(ownerToken, "Nate's Row");

            mockMvc.perform(put("/api/exercises/" + id)
                            .header("Authorization", bearer(memberToken))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(objectMapper.writeValueAsString(Map.of("name", "Not Nate's Row"))))
                    .andExpect(status().isForbidden());
        }

        @Test
        void aMemberMayRenameTheTagTheyCreatedButNotSomebodyElses() throws Exception {
            long mine = createTagAs(memberToken, "sam-pull");
            long theirs = createTagAs(ownerToken, "nate-push");

            mockMvc.perform(put("/api/tags/" + mine)
                            .header("Authorization", bearer(memberToken))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(objectMapper.writeValueAsString(Map.of("name", "sam-pull-day"))))
                    .andExpect(status().isOk());

            mockMvc.perform(put("/api/tags/" + theirs)
                            .header("Authorization", bearer(memberToken))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(objectMapper.writeValueAsString(Map.of("name", "hijacked"))))
                    .andExpect(status().isForbidden());
        }

        // Exercises have no member-facing delete at all -- unlike tags (below), there is no
        // DELETE_OWN counterpart for them: a shared row other people's history already points at
        // is not its creator's alone to remove, and that stays true even for what they made.
        // Refused by the interceptor, before the service runs.
        @Test
        void aMemberMayNotDeleteAnExerciseTheyCreated() throws Exception {
            long exerciseId = createExerciseAs(memberToken, "Sam's Curl");

            mockMvc.perform(delete("/api/exercises/" + exerciseId)
                            .header("Authorization", bearer(memberToken)))
                    .andExpect(status().isForbidden());
        }

        // The owner keeps EDIT_ANY_SHARED_RESOURCE, so authorship constrains members only. Without
        // this, "members can only edit their own" could be implemented as "everyone can only edit
        // their own" and every test above would still pass.
        @Test
        void theOwnerMayStillRenameWhatAMemberCreated() throws Exception {
            long id = createExerciseAs(memberToken, "Sam's Curl");

            mockMvc.perform(put("/api/exercises/" + id)
                            .header("Authorization", bearer(ownerToken))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(objectMapper.writeValueAsString(Map.of("name", "Curl (Sam)"))))
                    .andExpect(status().isOk());
        }

        // An UNATTRIBUTED row -- a preloaded global exercise, a row written by the previous release
        // mid-rolling-deploy, an account with no OWNER membership for V69 to attribute to. Null
        // must fail CLOSED for a member: failing open would hand them every row nobody claims.
        @Test
        void aMemberMayNotRenameAnUnattributedExercise() throws Exception {
            long id = createExerciseAs(ownerToken, "Orphan Lift");
            jdbc.update("UPDATE exercises SET created_by_user_id = NULL WHERE id = ?", id);

            mockMvc.perform(put("/api/exercises/" + id)
                            .header("Authorization", bearer(memberToken))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(objectMapper.writeValueAsString(Map.of("name", "Claimed"))))
                    .andExpect(status().isForbidden());

            // ...and the owner still can, so nothing has become uneditable.
            mockMvc.perform(put("/api/exercises/" + id)
                            .header("Authorization", bearer(ownerToken))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(objectMapper.writeValueAsString(Map.of("name", "Claimed"))))
                    .andExpect(status().isOk());
        }

        // Both dedup branches in ExerciseService.add return an EXISTING row. Re-attributing it to
        // whoever replayed the create would silently transfer who may rename it -- an offline
        // replay is not a claim of authorship.
        @Test
        void replayingACreateNeverTransfersAuthorship() throws Exception {
            long id = createExerciseAs(ownerToken, "Nate's Row");

            // Same name, same measure, dispatched by the member: the dedup branch returns the
            // owner's row rather than inserting a second one.
            long resolved = createExerciseAs(memberToken, "Nate's Row");
            assertThat(resolved).isEqualTo(id);

            // And it is still the owner's to rename, not theirs.
            mockMvc.perform(put("/api/exercises/" + id)
                            .header("Authorization", bearer(memberToken))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(objectMapper.writeValueAsString(Map.of("name", "Sam's Row"))))
                    .andExpect(status().isForbidden());
        }
    }

    /**
     * Unlike exercises, tags now carry a delete rule shaped exactly like the rename rule: a member
     * may remove a tag they created once nobody ELSE depends on it. {@code DELETE_OWN_SHARED_RESOURCE}
     * is what lets the interceptor admit a member here at all; {@code TagService.delete} is what
     * actually decides -- ownership first (403), in-use second (409), same ordering and same
     * probing rationale as {@code TagService.rename}.
     */
    @Nested
    @DisplayName("deleting a tag")
    class DeletingATag {

        private long createExerciseAs(String token, String name) throws Exception {
            return json(mockMvc.perform(post("/api/exercises")
                    .header("Authorization", bearer(token))
                    .contentType(MediaType.APPLICATION_JSON)
                    .content(objectMapper.writeValueAsString(Map.of("name", name)))))
                    .get("id").asLong();
        }

        private long createTagAs(String token, String name) throws Exception {
            return json(mockMvc.perform(post("/api/tags")
                    .header("Authorization", bearer(token))
                    .contentType(MediaType.APPLICATION_JSON)
                    .content(objectMapper.writeValueAsString(Map.of("name", name)))))
                    .get("id").asLong();
        }

        @Test
        void aMemberMayDeleteAnUnusedTagTheyCreated() throws Exception {
            long tagId = createTagAs(memberToken, "sam-pull");

            mockMvc.perform(delete("/api/tags/" + tagId)
                            .header("Authorization", bearer(memberToken)))
                    .andExpect(status().isNoContent());
        }

        // The one that matters. 403 rather than 404 -- the tag IS visible to them, it is in the
        // shared vocabulary they see every day -- so pretending it does not exist would be a lie
        // the tags list contradicts on the same screen.
        @Test
        void aMemberMayNotDeleteSomebodyElsesTag() throws Exception {
            long tagId = createTagAs(ownerToken, "nate-push");

            mockMvc.perform(delete("/api/tags/" + tagId)
                            .header("Authorization", bearer(memberToken)))
                    .andExpect(status().isForbidden());
        }

        // ⚠️ Deliberately NOT "no exercises at all". Applying your own tag to your own exercise
        // must not cost you the ability to remove your own tag -- the harm this rule prevents is
        // deleting a tag out from under somebody ELSE's history.
        @Test
        void usingItYourselfDoesNotLockYourOwnDelete() throws Exception {
            long exerciseId = createExerciseAs(memberToken, "Sam's Curl");
            long tagId = createTagAs(memberToken, "sam-pull");
            mockMvc.perform(put("/api/people/" + memberPersonId + "/exercises/" + exerciseId + "/tags")
                            .header("Authorization", bearer(memberToken))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(objectMapper.writeValueAsString(Map.of("tags", java.util.List.of("sam-pull")))))
                    .andExpect(status().isOk());

            mockMvc.perform(delete("/api/tags/" + tagId)
                            .header("Authorization", bearer(memberToken)))
                    .andExpect(status().isNoContent());
        }

        // The rule itself: the owner applies the member's tag to their own exercise, and it stops
        // being the member's to delete -- a 409, not a 403, because it IS theirs, just in use.
        @Test
        void aMemberMayNotDeleteTheirOwnTagOnceSomebodyElseUsesIt() throws Exception {
            long exerciseId = createExerciseAs(memberToken, "Shared Lift");
            long tagId = createTagAs(memberToken, "sam-pull");
            mockMvc.perform(put("/api/people/" + ownerPersonId + "/exercises/" + exerciseId + "/tags")
                            .header("Authorization", bearer(ownerToken))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(objectMapper.writeValueAsString(Map.of("tags", java.util.List.of("sam-pull")))))
                    .andExpect(status().isOk());

            mockMvc.perform(delete("/api/tags/" + tagId)
                            .header("Authorization", bearer(memberToken)))
                    .andExpect(status().isConflict());
        }

        // The owner keeps DELETE_SHARED_RESOURCE, which stays exactly as usage-unaware as it
        // always was -- authorship and in-use constrain a MEMBER only.
        @Test
        void theOwnerMayStillDeleteATagEvenWhileSomebodyUsesIt() throws Exception {
            long exerciseId = createExerciseAs(memberToken, "Shared Lift");
            long tagId = createTagAs(memberToken, "sam-pull");
            mockMvc.perform(put("/api/people/" + ownerPersonId + "/exercises/" + exerciseId + "/tags")
                            .header("Authorization", bearer(ownerToken))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(objectMapper.writeValueAsString(Map.of("tags", java.util.List.of("sam-pull")))))
                    .andExpect(status().isOk());

            mockMvc.perform(delete("/api/tags/" + tagId)
                            .header("Authorization", bearer(ownerToken)))
                    .andExpect(status().isNoContent());
        }

        // TagDto.deletable is what the client offers the control on -- it must answer the same
        // question TagService.delete itself decides, or the button and the endpoint disagree.
        @Test
        void listMarksOnlyTheDeletableTagsForAMember() throws Exception {
            long mine = createTagAs(memberToken, "sam-pull");
            long theirs = createTagAs(ownerToken, "nate-push");

            JsonNode tags = json(mockMvc.perform(get("/api/tags")
                    .header("Authorization", bearer(memberToken))));

            for (JsonNode tag : tags) {
                boolean expected = tag.get("id").asLong() == mine;
                assertThat(tag.get("deletable").asBoolean())
                        .as("tag %s deletable", tag.get("name").asText())
                        .isEqualTo(expected);
            }
            assertThat(tags).hasSize(2);
            // Sanity: both ids were actually seen above, not silently skipped by an empty list.
            assertThat(theirs).isPositive();
        }
    }

    /**
     * Renaming a shared row is allowed only while nobody ELSE is using it.
     *
     * <p>An exercise or tag is household-wide, so its name is the label on everyone's history.
     * Having created it does not make it yours forever — once somebody else has logged against it,
     * a rename silently relabels their sets, their Trends and their PRs.
     *
     * <p>The status codes carry the diagnosis and must not be collapsed: <b>403</b> is "not yours",
     * <b>409</b> is "yours, but in use". They point at different fixes, and 409 is the only one
     * that has a remedy to offer.
     */
    @Nested
    @DisplayName("renaming a shared resource that other people use")
    class RenameWhileUnused {

        private long createExerciseAs(String token, String name) throws Exception {
            return json(mockMvc.perform(post("/api/exercises")
                    .header("Authorization", bearer(token))
                    .contentType(MediaType.APPLICATION_JSON)
                    .content(objectMapper.writeValueAsString(Map.of("name", name)))))
                    .get("id").asLong();
        }

        private void logSetFor(String token, long personId, long exerciseId) throws Exception {
            mockMvc.perform(post("/api/people/" + personId + "/live-sets")
                            .header("Authorization", bearer(token))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(objectMapper.writeValueAsString(
                                    Map.of("exerciseId", exerciseId, "weight", 100, "reps", 5))))
                    .andExpect(status().isOk());
        }

        private String rename(String token, long exerciseId, String name) throws Exception {
            return mockMvc.perform(put("/api/exercises/" + exerciseId)
                            .header("Authorization", bearer(token))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(objectMapper.writeValueAsString(Map.of("name", name))))
                    .andReturn().getResponse().getContentAsString();
        }

        // Your own exercise, nobody else has touched it: rename freely.
        @Test
        void aMemberMayRenameTheirOwnUnusedExercise() throws Exception {
            long id = createExerciseAs(memberToken, "Sam's Curl");

            mockMvc.perform(put("/api/exercises/" + id)
                            .header("Authorization", bearer(memberToken))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(objectMapper.writeValueAsString(Map.of("name", "Sam's EZ Curl"))))
                    .andExpect(status().isOk());
        }

        // ⚠️ Deliberately NOT "no sets at all". Using your own exercise must not cost you the
        // ability to fix your own typo -- the harm this rule prevents is relabelling somebody
        // ELSE's history.
        @Test
        void usingItYourselfDoesNotLockYourOwnRename() throws Exception {
            long id = createExerciseAs(memberToken, "Sam's Curl");
            logSetFor(memberToken, memberPersonId, id);

            mockMvc.perform(put("/api/exercises/" + id)
                            .header("Authorization", bearer(memberToken))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(objectMapper.writeValueAsString(Map.of("name", "Sam's EZ Curl"))))
                    .andExpect(status().isOk());
        }

        // The rule itself: the owner logs against the member's exercise, and it stops being the
        // member's to rename.
        @Test
        void anotherPersonUsingItRefusesTheRenameWith409() throws Exception {
            long id = createExerciseAs(memberToken, "Sam's Curl");
            logSetFor(ownerToken, ownerPersonId, id);

            mockMvc.perform(put("/api/exercises/" + id)
                            .header("Authorization", bearer(memberToken))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(objectMapper.writeValueAsString(Map.of("name", "Renamed"))))
                    .andExpect(status().isConflict());
        }

        // A refusal a person cannot act on is just an obstacle. The message has to say what
        // happened AND who can fix it -- which is why MembershipDto carries the owner's name.
        @Test
        void theRefusalNamesTheOwnerAndOffersAWayForward() throws Exception {
            long id = createExerciseAs(memberToken, "Sam's Curl");
            logSetFor(ownerToken, ownerPersonId, id);

            String body = rename(memberToken, id, "Renamed");

            assertThat(body).contains("Nate");
            assertThat(body).contains("add your own");
        }

        // The owner is exempt -- they hold EDIT_ANY_SHARED_RESOURCE, and they are the remedy the
        // 409 above points at. Block them and that message has nobody to send you to.
        @Test
        void theOwnerMayStillRenameSomethingEveryoneUses() throws Exception {
            long id = createExerciseAs(memberToken, "Sam's Curl");
            logSetFor(ownerToken, ownerPersonId, id);
            logSetFor(memberToken, memberPersonId, id);

            mockMvc.perform(put("/api/exercises/" + id)
                            .header("Authorization", bearer(ownerToken))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(objectMapper.writeValueAsString(Map.of("name", "Curl (Sam)"))))
                    .andExpect(status().isOk());
        }

        // 403 and 409 are different diagnoses pointing at different fixes. Somebody else's
        // exercise is still 403 even when nobody has used it -- the in-use rule must not swallow
        // the ownership one.
        @Test
        void somebodyElsesExerciseIsStill403NotConflict() throws Exception {
            long id = createExerciseAs(ownerToken, "Nate's Row");

            mockMvc.perform(put("/api/exercises/" + id)
                            .header("Authorization", bearer(memberToken))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(objectMapper.writeValueAsString(Map.of("name", "Not Nate's Row"))))
                    .andExpect(status().isForbidden());
        }

        // Tags carry the same rule for the same reason: a tag is applied to OTHER people's
        // exercises, so renaming one relabels whatever they filed under it.
        @Test
        void aTagAppliedByAnotherPersonRefusesTheRenameWith409() throws Exception {
            long exerciseId = createExerciseAs(memberToken, "Shared Lift");
            long tagId = json(mockMvc.perform(post("/api/tags")
                    .header("Authorization", bearer(memberToken))
                    .contentType(MediaType.APPLICATION_JSON)
                    .content(objectMapper.writeValueAsString(Map.of("name", "sam-pull")))))
                    .get("id").asLong();

            // The OWNER applies it to their own copy of the exercise.
            mockMvc.perform(put("/api/people/" + ownerPersonId + "/exercises/" + exerciseId + "/tags")
                            .header("Authorization", bearer(ownerToken))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(objectMapper.writeValueAsString(Map.of("tags", java.util.List.of("sam-pull")))))
                    .andExpect(status().isOk());

            mockMvc.perform(put("/api/tags/" + tagId)
                            .header("Authorization", bearer(memberToken))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(objectMapper.writeValueAsString(Map.of("name", "renamed"))))
                    .andExpect(status().isConflict());
        }

        // /me tells a member who the owner is -- the field the 409 copy above depends on. Null for
        // an owner, who does not need telling.
        @Test
        void meNamesTheOwnerForAMemberAndNobodyForAnOwner() throws Exception {
            JsonNode memberMe = json(mockMvc.perform(get("/api/auth/me")
                    .header("Authorization", bearer(memberToken))));
            assertThat(memberMe.get("membership").get("ownerName").asText()).isEqualTo("Nate");

            JsonNode ownerMe = json(mockMvc.perform(get("/api/auth/me")
                    .header("Authorization", bearer(ownerToken))));
            assertThat(ownerMe.get("membership").get("ownerName").isNull()).isTrue();
        }
    }

}
