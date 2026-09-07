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
import org.springframework.test.web.servlet.ResultActions;

import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.nullable;
import static org.mockito.Mockito.timeout;
import static org.mockito.Mockito.verify;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * The invite round trip: an owner enables a login, somebody accepts it, and a member exists.
 *
 * <p>The security of this flow is not in any one check — it is in what the owner CANNOT learn and
 * what an invitation CANNOT do. Those are the tests that matter here.
 */
@AutoConfigureMockMvc
class MembershipInviteTest extends AbstractIntegrationTest {

    @DynamicPropertySource
    static void datasource(DynamicPropertyRegistry registry) {
        registerDatasource(registry, MembershipInviteTest.class);
    }

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private TestCodeCache testCodeCache;

    @Autowired
    private JdbcTemplate jdbc;

    @Autowired
    private MembershipInviteRepository inviteRepository;

    // Mocked so no ACS call happens; the raw token is read from the event/db instead. Every
    // integration test needs this regardless -- EmailService's constructor builds a live client.
    @MockitoBean
    private EmailService emailService;

    private final ObjectMapper objectMapper = new ObjectMapper();

    private String ownerToken;
    private long samPersonId;
    private long accountId;
    private String suffix;

    @BeforeEach
    void setUpHousehold() throws Exception {
        suffix = UUID.randomUUID().toString().substring(0, 8);
        ownerToken = RegistrationTestSupport
                .registerAndConfirm(mockMvc, objectMapper, testCodeCache, "owner-" + suffix + "@example.com", "Nate")
                .get("token").asText();

        accountId = json(mockMvc.perform(get("/api/auth/me")
                .header("Authorization", bearer(ownerToken))))
                .get("account").get("id").asLong();

        samPersonId = json(mockMvc.perform(post("/api/people")
                .header("Authorization", bearer(ownerToken))
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(Map.of("name", "Sam")))))
                .get("id").asLong();
    }

    private String bearer(String token) {
        return "Bearer " + token;
    }

    private JsonNode json(ResultActions actions) throws Exception {
        return objectMapper.readTree(actions.andReturn().getResponse().getContentAsString());
    }

    private JsonNode invite(long personId, String email) throws Exception {
        return json(mockMvc.perform(post("/api/account/logins/" + personId + "/invite")
                .header("Authorization", bearer(ownerToken))
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(Map.of("email", email))))
                .andExpect(status().isOk()));
    }

    /**
     * The raw token never leaves the invite event, so a test cannot read it back from the database
     * (which holds a BCrypt hash). Overwriting the hash with one for a known string is the only way
     * to drive accept from here — and it exercises the real {@code matches()} path rather than
     * stubbing the check out.
     */
    private String plantKnownToken(long inviteId) {
        String known = "known-test-token-" + inviteId;
        String hash = new org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder().encode(known);
        jdbc.update("UPDATE membership_invites SET token_hash = ? WHERE id = ?", hash, inviteId);
        return known;
    }

    /**
     * ⚠️ Scoped to THIS test's account and person, never findAll().
     *
     * <p>Every class in this suite shares one database, so findAll() returns other tests' invites
     * too — and it did: the first draft picked up a neighbouring test's row and asserted against
     * the wrong person id. Nothing about that failure pointed at the helper.
     */
    private long pendingInviteId(long personId) {
        return inviteRepository.findPendingFor(accountId, personId)
                .map(MembershipInvite::getId)
                .orElseThrow();
    }

    @Nested
    @DisplayName("the owner's view")
    class OwnerView {

        @Test
        void listsEveryPersonWithTheirLoginState() throws Exception {
            JsonNode logins = json(mockMvc.perform(get("/api/account/logins")
                    .header("Authorization", bearer(ownerToken)))
                    .andExpect(status().isOk()));

            assertThat(logins).hasSize(2);
            // The owner's own person has a membership from registration; Sam has nothing yet.
            assertThat(logins.findValuesAsText("status")).containsExactlyInAnyOrder("ACTIVE", "NONE");
        }

        @Test
        void invitingMovesThatPersonToInvited() throws Exception {
            invite(samPersonId, "sam-" + suffix + "@example.com");

            JsonNode logins = json(mockMvc.perform(get("/api/account/logins")
                    .header("Authorization", bearer(ownerToken))));
            JsonNode sam = logins.get(0).get("personId").asLong() == samPersonId ? logins.get(0) : logins.get(1);

            assertThat(sam.get("status").asText()).isEqualTo("INVITED");
            assertThat(sam.get("email").asText()).isEqualTo("sam-" + suffix + "@example.com");
        }

        /**
         * ⚠️ THE ENUMERATION ORACLE, and the single most important test in this class.
         *
         * <p>Inviting an address that ALREADY has a Huddle account must look exactly like inviting
         * one that does not. If the response ever differs — an extra state, an "activated" flag, a
         * different status — anyone with a household can type an address and learn whether that
         * person uses Huddle, through a route requiring no password at all.
         */
        @Test
        void anExistingAccountIsIndistinguishableFromANewOne() throws Exception {
            String strangerEmail = "stranger-" + suffix + "@example.com";
            RegistrationTestSupport.registerAndConfirm(mockMvc, objectMapper, testCodeCache, strangerEmail, "Robin");

            JsonNode knownAddress = invite(samPersonId, strangerEmail);

            long otherPersonId = json(mockMvc.perform(post("/api/people")
                    .header("Authorization", bearer(ownerToken))
                    .contentType(MediaType.APPLICATION_JSON)
                    .content(objectMapper.writeValueAsString(Map.of("name", "Alex")))))
                    .get("id").asLong();
            JsonNode unknownAddress = invite(otherPersonId, "nobody-" + suffix + "@example.com");

            // Identical in every field that is not the person or the address the owner typed.
            assertThat(knownAddress.get("status").asText()).isEqualTo("INVITED");
            assertThat(unknownAddress.get("status").asText()).isEqualTo("INVITED");
            assertThat(knownAddress.fieldNames()).toIterable()
                    .containsExactlyInAnyOrderElementsOf(() -> unknownAddress.fieldNames());
        }

        /**
         * ⚠️ The invitation is worthless if the email never leaves, and NOTHING ELSE IN THIS SUITE
         * would notice: every other test here reads the invite row (or plants its token) straight
         * out of the database, and so does the e2e via {@code /api/auth/test/pending-invite}. So
         * the flow was green end to end while sending nothing at all.
         *
         * <p>That is exactly the shape the async-email contract forbids — "didn't run" and "ran
         * fine" indistinguishable from outside — so the send gets its own assertion. See
         * {@code MembershipInviteService#announce} for the cause.
         */
        @Test
        void theInvitationEmailIsActuallySent() throws Exception {
            String samEmail = "sam-" + suffix + "@example.com";

            invite(samPersonId, samEmail);

            // The link is built for THIS invitation -- the assertion that would catch an email
            // going out carrying somebody else's token.
            verify(emailService, timeout(2000)).joinUrl(eq(pendingInviteId(samPersonId)), anyString());

            // joinUrl is nullable() rather than anyString() only because EmailService is itself the
            // mock: its own joinUrl therefore answers null, and that null is what reaches this
            // call. A property of the double, not of the code under test.
            verify(emailService, timeout(2000))
                    .sendMembershipInvite(eq(samEmail), eq("Sam"), anyString(), anyString(),
                            nullable(String.class), anyBoolean());
        }

        @Test
        void aMemberCannotSeeOrSendLogins() throws Exception {
            String memberEmail = "member-" + suffix + "@example.com";
            mockMvc.perform(post("/api/auth/test/member")
                            .header("X-E2E-Test-Key", "local-dev-only-e2e-test-key-do-not-use-elsewhere")
                            .param("ownerEmail", "owner-" + suffix + "@example.com")
                            .param("personName", "Sam")
                            .param("memberEmail", memberEmail)
                            .param("password", "password123"))
                    .andExpect(status().isNoContent());
            String memberToken = json(mockMvc.perform(post("/api/auth/login")
                    .contentType(MediaType.APPLICATION_JSON)
                    .content(objectMapper.writeValueAsString(
                            Map.of("email", memberEmail, "password", "password123")))))
                    .get("token").asText();

            mockMvc.perform(get("/api/account/logins").header("Authorization", bearer(memberToken)))
                    .andExpect(status().isForbidden());
            mockMvc.perform(post("/api/account/logins/" + samPersonId + "/invite")
                            .header("Authorization", bearer(memberToken))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(objectMapper.writeValueAsString(Map.of("email", "x@example.com"))))
                    .andExpect(status().isForbidden());
        }
    }

    @Nested
    @DisplayName("accepting")
    class Accepting {

        private JsonNode accept(long inviteId, String token, String password) throws Exception {
            Map<String, Object> body = password == null
                    ? Map.of("inviteId", inviteId, "token", token)
                    : Map.of("inviteId", inviteId, "token", token, "password", password);
            return json(mockMvc.perform(post("/api/auth/accept-invite")
                    .contentType(MediaType.APPLICATION_JSON)
                    .content(objectMapper.writeValueAsString(body))));
        }

        @Test
        void aNewAddressChoosesAPasswordAndIsSignedStraightIn() throws Exception {
            invite(samPersonId, "sam-" + suffix + "@example.com");
            long inviteId = pendingInviteId(samPersonId);
            String token = plantKnownToken(inviteId);

            JsonNode session = accept(inviteId, token, "password123");

            assertThat(session.get("token").asText()).isNotBlank();
            assertThat(session.get("membership").get("accountRole").asText()).isEqualTo("MEMBER");
            assertThat(session.get("membership").get("personId").asLong()).isEqualTo(samPersonId);
            // The transparency line's data: a member is told who the owner is.
            assertThat(session.get("membership").get("ownerName").asText()).isEqualTo("Nate");
        }

        /**
         * ⚠️ THE RACE. An invited address can register its OWN household between the invite going
         * out and being accepted. By accept time the user exists, so creating one would collide on
         * the unique email index and fail an otherwise-valid invitation.
         *
         * <p>And the supplied password must be IGNORED: an invitation silently changing somebody's
         * existing credentials is the one thing a household owner must never be able to do.
         */
        @Test
        void anAddressThatRegisteredMeanwhileKeepsItsOwnPassword() throws Exception {
            String email = "sam-" + suffix + "@example.com";
            invite(samPersonId, email);
            long inviteId = pendingInviteId(samPersonId);
            String token = plantKnownToken(inviteId);

            // They register their own household first, with their own password.
            RegistrationTestSupport.registerAndConfirm(mockMvc, objectMapper, testCodeCache, email, "Sam");

            accept(inviteId, token, "a-different-password");

            // Their ORIGINAL password still works...
            mockMvc.perform(post("/api/auth/login")
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(objectMapper.writeValueAsString(
                                    Map.of("email", email, "password", "password123"))))
                    .andExpect(status().isOk());
            // ...and the one supplied to accept does not.
            mockMvc.perform(post("/api/auth/login")
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(objectMapper.writeValueAsString(
                                    Map.of("email", email, "password", "a-different-password"))))
                    .andExpect(status().isUnauthorized());
        }

        @Test
        void aWrongTokenIsRefused() throws Exception {
            invite(samPersonId, "sam-" + suffix + "@example.com");
            long inviteId = pendingInviteId(samPersonId);
            plantKnownToken(inviteId);

            mockMvc.perform(post("/api/auth/accept-invite")
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(objectMapper.writeValueAsString(
                                    Map.of("inviteId", inviteId, "token", "not-the-token"))))
                    .andExpect(status().isUnauthorized());
        }

        // An invitation is single-use. Replaying a link that already worked must not mint a second
        // membership or re-open a household to somebody who has since been removed.
        @Test
        void anAcceptedInviteCannotBeReused() throws Exception {
            invite(samPersonId, "sam-" + suffix + "@example.com");
            long inviteId = pendingInviteId(samPersonId);
            String token = plantKnownToken(inviteId);
            accept(inviteId, token, "password123");

            mockMvc.perform(post("/api/auth/accept-invite")
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(objectMapper.writeValueAsString(
                                    Map.of("inviteId", inviteId, "token", token))))
                    .andExpect(status().isUnauthorized());
        }

        // One login per person (UX_account_memberships_account_person). Reads as a conflict rather
        // than surfacing later as a 503 from the unique-index violation.
        @Test
        void invitingAPersonWhoAlreadyHasALoginIsAConflict() throws Exception {
            invite(samPersonId, "sam-" + suffix + "@example.com");
            long inviteId = pendingInviteId(samPersonId);
            accept(inviteId, plantKnownToken(inviteId), "password123");

            mockMvc.perform(post("/api/account/logins/" + samPersonId + "/invite")
                            .header("Authorization", bearer(ownerToken))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(objectMapper.writeValueAsString(Map.of("email", "again@example.com"))))
                    .andExpect(status().isConflict());
        }
    }
}
