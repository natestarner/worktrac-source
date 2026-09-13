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
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders;

import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.nullable;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.timeout;
import static org.mockito.Mockito.verify;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
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

        // ⚠️ Plus FIRST. Member logins are a Plus feature and inviting is refused on Free, so a
        // freshly-registered (therefore Free) household would 409 on every invite below. The one
        // test that cares about that refusal downgrades explicitly.
        mockMvc.perform(post("/api/auth/test/billing-plan")
                        .header("X-E2E-Test-Key", "local-dev-only-e2e-test-key-do-not-use-elsewhere")
                        .param("email", "owner-" + suffix + "@example.com")
                        .param("plan", "PLUS"))
                .andExpect(status().isNoContent());

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

        /**
         * The client withholds <b>Remove</b> on the viewer's own row, and this flag is the only
         * thing that lets it: every row here is a person in the viewer's own household, so nothing
         * else in the payload separates "me" from "somebody else here". Without it the owner is
         * offered a control that can only ever answer 409.
         */
        @Test
        void marksTheViewersOwnRow() throws Exception {
            JsonNode logins = json(mockMvc.perform(get("/api/account/logins")
                    .header("Authorization", bearer(ownerToken))));

            JsonNode nate = logins.get(0).get("personId").asLong() == samPersonId ? logins.get(1) : logins.get(0);
            JsonNode sam = logins.get(0).get("personId").asLong() == samPersonId ? logins.get(0) : logins.get(1);

            assertThat(nate.get("isSelf").asBoolean()).isTrue();
            assertThat(sam.get("isSelf").asBoolean()).isFalse();
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

        /**
         * ⚠️ Refused on Free, and this is about not making a promise the product cannot keep.
         * Without it an owner invites, the invitee chooses a password and accepts, and lands
         * straight on "your login is paused" -- an onboarding flow whose SUCCESSFUL path is a dead
         * end.
         *
         * <p>409, not 403: they hold MANAGE_LOGINS perfectly well and will be able to do exactly
         * this the moment the household is Plus. A 403 would say "not you", which is the wrong
         * diagnosis and points at the wrong fix.
         */
        @Test
        void invitingIsRefusedWhileTheHouseholdIsOnFree() throws Exception {
            mockMvc.perform(post("/api/auth/test/billing-plan")
                            .header("X-E2E-Test-Key", "local-dev-only-e2e-test-key-do-not-use-elsewhere")
                            .param("email", "owner-" + suffix + "@example.com")
                            .param("plan", "FREE"))
                    .andExpect(status().isNoContent());

            mockMvc.perform(post("/api/account/logins/" + samPersonId + "/invite")
                            .header("Authorization", bearer(ownerToken))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(objectMapper.writeValueAsString(
                                    Map.of("email", "sam-" + suffix + "@example.com"))))
                    .andExpect(status().isConflict());

            // ...and nothing was created, so there is no orphaned invitation to trip over later.
            assertThat(inviteRepository.findPendingFor(accountId, samPersonId)).isEmpty();
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

        private ResultActions post(long inviteId, String token, String password, String sessionToken)
                throws Exception {
            Map<String, Object> body = password == null
                    ? Map.of("inviteId", inviteId, "token", token)
                    : Map.of("inviteId", inviteId, "token", token, "password", password);
            var request = MockMvcRequestBuilders.post("/api/auth/accept-invite")
                    .contentType(MediaType.APPLICATION_JSON)
                    .content(objectMapper.writeValueAsString(body));
            if (sessionToken != null) {
                request = request.header("Authorization", bearer(sessionToken));
            }
            return mockMvc.perform(request);
        }

        private JsonNode accept(long inviteId, String token, String password) throws Exception {
            return json(post(inviteId, token, password, null).andExpect(status().isOk()));
        }

        private JsonNode preview(long inviteId, String token) throws Exception {
            return json(mockMvc.perform(MockMvcRequestBuilders.post("/api/auth/invite/preview")
                    .contentType(MediaType.APPLICATION_JSON)
                    .content(objectMapper.writeValueAsString(Map.of("inviteId", inviteId, "token", token))))
                    .andExpect(status().isOk()));
        }

        /** An invitation for Sam, ready to accept. Returns {inviteId, rawToken}. */
        private long[] pendingInviteFor(String email) throws Exception {
            invite(samPersonId, email);
            long inviteId = pendingInviteId(samPersonId);
            plantKnownToken(inviteId);
            return new long[]{inviteId};
        }

        private boolean samHasAMembership() {
            return inviteRepository.findById(pendingInviteId(samPersonId)).isPresent();
        }

        // ── The unchanged path: a brand-new address is SETTING a password ────────────────────

        @Test
        void aNewAddressChoosesAPasswordAndIsSignedStraightIn() throws Exception {
            invite(samPersonId, "sam-" + suffix + "@example.com");
            long inviteId = pendingInviteId(samPersonId);
            String token = plantKnownToken(inviteId);

            JsonNode session = accept(inviteId, token, "password123");

            // One membership, so no picker: signed straight in, byte-for-byte as before.
            assertThat(session.get("token").asText()).isNotBlank();
            assertThat(session.get("households").isNull()).isTrue();
            assertThat(session.get("membership").get("accountRole").asText()).isEqualTo("MEMBER");
            assertThat(session.get("membership").get("personId").asLong()).isEqualTo(samPersonId);
            // The transparency line's data: a member is told who the owner is.
            assertThat(session.get("membership").get("ownerName").asText()).isEqualTo("Nate");
        }

        // ── An address that already has a login must PROVE it ────────────────────────────────

        /**
         * ⚠️ <b>THE HOLE THIS CLOSED, and the single most important test in this file.</b>
         *
         * <p>Accepting used to hand an already-registered address a full 30-day session on the
         * strength of the emailed link alone — no password, none asked for, one supplied silently
         * ignored. Since {@code POST /api/auth/session} takes a session token, whoever held that
         * link could then reach every other household that person belonged to, their own included.
         * Any household owner could cause such a link to be mailed to any address they could type.
         *
         * <p>Both halves matter: the refusal, and that <b>no membership was created</b>. A version
         * that refused the response but attached the membership anyway would still have handed the
         * household away.
         */
        @Test
        void anExistingAddressCannotJoinWithoutItsPassword() throws Exception {
            String email = "sam-" + suffix + "@example.com";
            RegistrationTestSupport.registerAndConfirm(mockMvc, objectMapper, testCodeCache, email, "Sam");
            invite(samPersonId, email);
            long inviteId = pendingInviteId(samPersonId);
            String token = plantKnownToken(inviteId);

            // No password at all.
            post(inviteId, token, null, null).andExpect(status().isForbidden());
            // The wrong one.
            post(inviteId, token, "not-their-password", null).andExpect(status().isForbidden());

            // Nothing was attached, and the invitation is still live for the real Sam.
            assertThat(inviteRepository.findById(inviteId).orElseThrow().isAccepted()).isFalse();
            JsonNode logins = json(mockMvc.perform(get("/api/account/logins")
                    .header("Authorization", bearer(ownerToken))));
            JsonNode sam = logins.get(0).get("personId").asLong() == samPersonId ? logins.get(0) : logins.get(1);
            assertThat(sam.get("status").asText()).isEqualTo("INVITED");
        }

        /**
         * The right password joins — and lands on the household picker rather than in a household,
         * because this credential now belongs to two. That is the SAME shape {@code /login} returns
         * for a multi-household credential, deliberately: no new response vocabulary, and the
         * screen they get is the one they would have seen on their next sign-in anyway.
         */
        @Test
        void anExistingAddressJoinsWithItsPasswordAndGetsThePicker() throws Exception {
            String email = "sam-" + suffix + "@example.com";
            RegistrationTestSupport.registerAndConfirm(mockMvc, objectMapper, testCodeCache, email, "Sam");
            invite(samPersonId, email);
            long inviteId = pendingInviteId(samPersonId);
            String token = plantKnownToken(inviteId);

            JsonNode response = accept(inviteId, token, RegistrationTestSupport.PASSWORD);

            assertThat(response.get("token").isNull()).isTrue();
            assertThat(response.get("selectionToken").asText()).isNotBlank();
            assertThat(response.get("households")).hasSize(2);
            // Their own household and the one they just joined, in that order (oldest first).
            assertThat(response.get("households").get(0).get("accountRole").asText()).isEqualTo("OWNER");
            assertThat(response.get("households").get(1).get("accountRole").asText()).isEqualTo("MEMBER");

            // And the selection token really finishes the job.
            long joinedAccountId = response.get("households").get(1).get("accountId").asLong();
            JsonNode session = json(mockMvc.perform(MockMvcRequestBuilders.post("/api/auth/session")
                    .header("Authorization", bearer(response.get("selectionToken").asText()))
                    .contentType(MediaType.APPLICATION_JSON)
                    .content(objectMapper.writeValueAsString(Map.of("accountId", joinedAccountId))))
                    .andExpect(status().isOk()));
            assertThat(session.get("token").asText()).isNotBlank();
            assertThat(session.get("membership").get("accountRole").asText()).isEqualTo("MEMBER");
        }

        /**
         * ⚠️ THE RACE. An invited address can register its OWN household between the invite going
         * out and being accepted. By accept time the user exists, so creating one would collide on
         * the unique email index and fail an otherwise-valid invitation.
         *
         * <p>And an invitation must never CHANGE those credentials: a household owner being able to
         * overwrite somebody's password is the one thing this design must not allow. Proving the
         * password is now how you join; it is still not a way to set one.
         */
        @Test
        void anAddressThatRegisteredMeanwhileKeepsItsOwnPassword() throws Exception {
            String email = "sam-" + suffix + "@example.com";
            invite(samPersonId, email);
            long inviteId = pendingInviteId(samPersonId);
            String token = plantKnownToken(inviteId);

            // They register their own household first, with their own password.
            RegistrationTestSupport.registerAndConfirm(mockMvc, objectMapper, testCodeCache, email, "Sam");

            // Joining with their real password works...
            accept(inviteId, token, RegistrationTestSupport.PASSWORD);

            // ...their ORIGINAL password still works at /login...
            mockMvc.perform(MockMvcRequestBuilders.post("/api/auth/login")
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(objectMapper.writeValueAsString(
                                    Map.of("email", email, "password", RegistrationTestSupport.PASSWORD))))
                    .andExpect(status().isOk());
            // ...and nothing about accepting invented a second one.
            mockMvc.perform(MockMvcRequestBuilders.post("/api/auth/login")
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(objectMapper.writeValueAsString(
                                    Map.of("email", email, "password", "a-different-password"))))
                    .andExpect(status().isUnauthorized());
        }

        /**
         * The invitee is already signed in as the invited address — a shared iPad, or the second
         * household on their own phone. Their session is the proof, and it is the STRONGER of the
         * two: it reached the security context only after JwtAuthenticationFilter checked the
         * signature, refused any {@code scp}, and resolved {@code tv} against the live user row.
         */
        @Test
        void anInviteeAlreadySignedInJoinsWithNoPassword() throws Exception {
            String email = "sam-" + suffix + "@example.com";
            String samToken = RegistrationTestSupport
                    .registerAndConfirm(mockMvc, objectMapper, testCodeCache, email, "Sam")
                    .get("token").asText();
            invite(samPersonId, email);
            long inviteId = pendingInviteId(samPersonId);
            String token = plantKnownToken(inviteId);

            JsonNode response = json(post(inviteId, token, null, samToken).andExpect(status().isOk()));

            assertThat(response.get("token").isNull()).isTrue();
            assertThat(response.get("households")).hasSize(2);
        }

        /**
         * ⚠️ Being signed in as SOMEBODY ELSE proves nothing about the invitee, and must not be
         * mistaken for proof. The client's job here is to offer to switch; the server's job is to
         * refuse — and, in particular, not to silently swap the signed-in identity, which is what
         * this route did before it asked for anything.
         */
        @Test
        void aSignedInStrangerCannotJoinOnTheInviteesBehalf() throws Exception {
            String email = "sam-" + suffix + "@example.com";
            RegistrationTestSupport.registerAndConfirm(mockMvc, objectMapper, testCodeCache, email, "Sam");
            invite(samPersonId, email);
            long inviteId = pendingInviteId(samPersonId);
            String token = plantKnownToken(inviteId);

            // Somebody else entirely, signed in on this device.
            String strangerToken = RegistrationTestSupport.registerAndConfirm(
                            mockMvc, objectMapper, testCodeCache, "stranger-" + suffix + "@example.com", "Alex")
                    .get("token").asText();

            post(inviteId, token, null, strangerToken).andExpect(status().isForbidden());
            post(inviteId, token, "guessing", strangerToken).andExpect(status().isForbidden());

            assertThat(inviteRepository.findById(inviteId).orElseThrow().isAccepted()).isFalse();
            // The stranger's own session is untouched -- it was never the credential in question.
            mockMvc.perform(get("/api/auth/me").header("Authorization", bearer(strangerToken)))
                    .andExpect(status().isOk());
        }

        /**
         * A wrong password here costs an attempt against the SAME ten-strike lockout as /login,
         * because otherwise this route is an unthrottled password oracle sitting next to the
         * throttled one.
         *
         * <p>⚠️ Asserted against the user row, never by driving a 429: integration tests run under
         * {@code @ActiveProfiles("local")}, where every rate limit is 100000, so a limiter-based
         * assertion here would pass whether or not the code called the limiter at all.
         */
        @Test
        void aWrongPasswordCountsTowardTheOrdinaryLoginLockout() throws Exception {
            String email = "sam-" + suffix + "@example.com";
            RegistrationTestSupport.registerAndConfirm(mockMvc, objectMapper, testCodeCache, email, "Sam");
            invite(samPersonId, email);
            long inviteId = pendingInviteId(samPersonId);
            String token = plantKnownToken(inviteId);

            post(inviteId, token, "wrong-password-1", null).andExpect(status().isForbidden());
            post(inviteId, token, "wrong-password-2", null).andExpect(status().isForbidden());

            Integer attempts = jdbc.queryForObject(
                    "SELECT failed_login_attempts FROM users WHERE email = ?", Integer.class, email);
            assertThat(attempts).isEqualTo(2);

            // A missing password is NOT an attempt -- it carried no guess, so it must not be able
            // to lock the invitee out of their own account.
            post(inviteId, token, null, null).andExpect(status().isForbidden());
            assertThat(jdbc.queryForObject(
                    "SELECT failed_login_attempts FROM users WHERE email = ?", Integer.class, email))
                    .isEqualTo(2);

            // And the right one still clears it.
            accept(inviteId, token, RegistrationTestSupport.PASSWORD);
            assertThat(jdbc.queryForObject(
                    "SELECT failed_login_attempts FROM users WHERE email = ?", Integer.class, email))
                    .isZero();
        }

        // ── Preview ──────────────────────────────────────────────────────────────────────────

        /**
         * The whole reason preview exists: the screen cannot ask the right question without it.
         *
         * <p>Answering this to the holder of a valid token is not the enumeration oracle the invite
         * design forbids — that one is the OWNER's, and an owner never sees this token. See
         * {@code MembershipInviteService#preview}. {@code anExistingAccountIsIndistinguishableFromANewOne}
         * is the test that keeps the owner's view closed, and it must stay green alongside this one.
         */
        @Test
        void previewSaysSignInForAKnownAddressAndSetPasswordForANewOne() throws Exception {
            String email = "sam-" + suffix + "@example.com";
            invite(samPersonId, email);
            long inviteId = pendingInviteId(samPersonId);
            String token = plantKnownToken(inviteId);

            JsonNode unknown = preview(inviteId, token);
            assertThat(unknown.get("mode").asText()).isEqualTo("SET_PASSWORD");
            assertThat(unknown.get("householdName").asText()).isNotBlank();
            assertThat(unknown.get("personName").asText()).isEqualTo("Sam");
            assertThat(unknown.get("email").asText()).isEqualTo(email);

            RegistrationTestSupport.registerAndConfirm(mockMvc, objectMapper, testCodeCache, email, "Sam");

            assertThat(preview(inviteId, token).get("mode").asText()).isEqualTo("SIGN_IN");
        }

        /** Preview runs the same gauntlet as accepting, so it cannot be a free guessing oracle. */
        @Test
        void aBadTokenOnPreviewBurnsAnAttemptAndRefusesLikeAccept() throws Exception {
            invite(samPersonId, "sam-" + suffix + "@example.com");
            long inviteId = pendingInviteId(samPersonId);
            plantKnownToken(inviteId);

            mockMvc.perform(MockMvcRequestBuilders.post("/api/auth/invite/preview")
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(objectMapper.writeValueAsString(
                                    Map.of("inviteId", inviteId, "token", "not-the-token"))))
                    .andExpect(status().isForbidden());

            assertThat(inviteRepository.findById(inviteId).orElseThrow().getAttemptCount()).isEqualTo(1);
        }

        // ── The refusals ─────────────────────────────────────────────────────────────────────

        /**
         * ⚠️ <b>NEITHER ROUTE MAY ANSWER 401, and this is not a cosmetic preference.</b>
         *
         * <p>Both are permitAll, but the browser attaches whatever session token it holds to every
         * request {@code api/client.js} makes — and that module reads ANY 401 on a token-bearing
         * request as "your session expired", clearing the token and force-navigating to /login with
         * no per-route opt-out. So a signed-in person who opened a stale or already-used invite
         * link was thrown out of their own working session and never saw the reason.
         *
         * <p>Asserted WITH a live session attached, because that is the only shape that can
         * reproduce it — the same reason the pre-existing e2e could not catch this at all
         * ({@code member-invite.spec.ts} logs out before opening the link).
         */
        @Test
        void noInviteRefusalEverAnswers401() throws Exception {
            String bystanderToken = RegistrationTestSupport.registerAndConfirm(
                            mockMvc, objectMapper, testCodeCache, "bystander-" + suffix + "@example.com", "Alex")
                    .get("token").asText();

            invite(samPersonId, "sam-" + suffix + "@example.com");
            long inviteId = pendingInviteId(samPersonId);
            String token = plantKnownToken(inviteId);

            // A wrong token, an unknown invite id, and -- once spent -- a replayed link.
            post(inviteId, "not-the-token", null, bystanderToken).andExpect(status().isForbidden());
            post(999_999_999L, token, null, bystanderToken).andExpect(status().isForbidden());
            accept(inviteId, token, "password123");
            post(inviteId, token, null, bystanderToken).andExpect(status().isForbidden());

            mockMvc.perform(MockMvcRequestBuilders.post("/api/auth/invite/preview")
                            .header("Authorization", bearer(bystanderToken))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(objectMapper.writeValueAsString(
                                    Map.of("inviteId", inviteId, "token", token))))
                    .andExpect(status().isForbidden());

            // The bystander is still signed in -- which is the entire point.
            mockMvc.perform(get("/api/auth/me").header("Authorization", bearer(bystanderToken)))
                    .andExpect(status().isOk());
        }

        /**
         * ⚠️ The attempt ceiling on the emailed token, which had <b>never once fired</b>.
         *
         * <p>The bad-token branch increments {@code attemptCount} and then throws, and without
         * {@code noRollbackFor} Spring rolled that increment back every single time — so the
         * counter sat at zero forever and {@code MAX_ATTEMPTS} was decorative.
         * {@code RegistrationService} and {@code PasswordResetService} both carry the annotation
         * for exactly this; the invite path was the one of the three that did not.
         *
         * <p>Remove {@code noRollbackFor} from {@code requireValidInvite} and this fails at the
         * counter assertion (0, not 5) — verified.
         */
        @Test
        void fiveWrongTokensLockTheInvitationOut() throws Exception {
            invite(samPersonId, "sam-" + suffix + "@example.com");
            long inviteId = pendingInviteId(samPersonId);
            String token = plantKnownToken(inviteId);

            for (int i = 0; i < 5; i++) {
                post(inviteId, "not-the-token", null, null).andExpect(status().isForbidden());
            }

            assertThat(inviteRepository.findById(inviteId).orElseThrow().getAttemptCount()).isEqualTo(5);

            // Ceiling reached: even the RIGHT token is now refused, and the ceiling is checked
            // before the BCrypt comparison so a locked-out invite costs no hashing either.
            post(inviteId, token, "password123", null).andExpect(status().isForbidden());
        }

        // AcceptInviteRequest's password is optional (null must keep validating), but a SUPPLIED
        // one gets the same 8..200 floor as registration, reset and change-password. This DTO
        // used to carry no @Size at all, so a one-character password sailed straight through.
        @Test
        void aTooShortPasswordIsRejected() throws Exception {
            invite(samPersonId, "sam-" + suffix + "@example.com");
            long inviteId = pendingInviteId(samPersonId);
            String token = plantKnownToken(inviteId);

            post(inviteId, token, "short", null).andExpect(status().isBadRequest());

            // The rejected attempt must not have consumed the invitation -- the link still works.
            accept(inviteId, token, "password123");
        }

        @Test
        void aWrongTokenIsRefused() throws Exception {
            invite(samPersonId, "sam-" + suffix + "@example.com");
            long inviteId = pendingInviteId(samPersonId);
            plantKnownToken(inviteId);

            post(inviteId, "not-the-token", null, null).andExpect(status().isForbidden());
        }

        // An invitation is single-use. Replaying a link that already worked must not mint a second
        // membership or re-open a household to somebody who has since been removed.
        @Test
        void anAcceptedInviteCannotBeReused() throws Exception {
            invite(samPersonId, "sam-" + suffix + "@example.com");
            long inviteId = pendingInviteId(samPersonId);
            String token = plantKnownToken(inviteId);
            accept(inviteId, token, "password123");

            post(inviteId, token, null, null).andExpect(status().isForbidden());
        }

        // One login per person (UX_account_memberships_account_person). Reads as a conflict rather
        // than surfacing later as a 503 from the unique-index violation.
        @Test
        void invitingAPersonWhoAlreadyHasALoginIsAConflict() throws Exception {
            invite(samPersonId, "sam-" + suffix + "@example.com");
            long inviteId = pendingInviteId(samPersonId);
            accept(inviteId, plantKnownToken(inviteId), "password123");

            mockMvc.perform(MockMvcRequestBuilders.post("/api/account/logins/" + samPersonId + "/invite")
                            .header("Authorization", bearer(ownerToken))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(objectMapper.writeValueAsString(Map.of("email", "again@example.com"))))
                    .andExpect(status().isConflict());
        }
    }
    @Nested
    @DisplayName("revoking")
    class Revoking {

        private ResultActions revoke(long personId, String token) throws Exception {
            return mockMvc.perform(delete("/api/account/logins/" + personId)
                    .header("Authorization", bearer(token)));
        }

        /** Gives Sam a real, working login. Returns Sam's session token. */
        private String makeSamAMember() throws Exception {
            String email = "sam-" + suffix + "@example.com";
            invite(samPersonId, email);
            long inviteId = pendingInviteId(samPersonId);
            String token = plantKnownToken(inviteId);
            return json(mockMvc.perform(post("/api/auth/accept-invite")
                    .contentType(MediaType.APPLICATION_JSON)
                    .content(objectMapper.writeValueAsString(Map.of(
                            "inviteId", inviteId, "token", token, "password", "password123")))))
                    .get("token").asText();
        }

        /**
         * ⚠️ <b>THE PERSON AND THEIR TRAINING DATA STAY.</b> This is the assertion the whole
         * feature's copy rests on: the revoke confirmation promises the owner that removing a login
         * removes access and nothing else. If that ever stops being true, the promise becomes a
         * lie at the exact moment somebody acts on it.
         */
        @Test
        void removingALoginLeavesThePersonAndTheirWorkoutsAlone() throws Exception {
            makeSamAMember();

            revoke(samPersonId, ownerToken).andExpect(status().isNoContent());

            JsonNode logins = json(mockMvc.perform(get("/api/account/logins")
                    .header("Authorization", bearer(ownerToken))));
            JsonNode sam = logins.get(0).get("personId").asLong() == samPersonId ? logins.get(0) : logins.get(1);

            // Sam is still here, still visible to the owner -- just with no way to sign in.
            assertThat(logins).hasSize(2);
            assertThat(sam.get("personName").asText()).isEqualTo("Sam");
            assertThat(sam.get("status").asText()).isEqualTo("NONE");
        }

        @Test
        void aRevokedMembersTokenStopsWorking() throws Exception {
            String samToken = makeSamAMember();
            // It genuinely worked first -- otherwise the assertion below proves nothing.
            mockMvc.perform(get("/api/auth/me").header("Authorization", bearer(samToken)))
                    .andExpect(status().isOk());

            revoke(samPersonId, ownerToken).andExpect(status().isNoContent());

            mockMvc.perform(get("/api/auth/me").header("Authorization", bearer(samToken)))
                    .andExpect(status().isUnauthorized());
        }

        /**
         * ⚠️ Revoking must NOT sign somebody out of their OTHER households.
         *
         * <p>This is why revoke calls {@code accountAccessService.invalidate(userId, accountId)}
         * and deliberately does NOT bump {@code token_version}, which is per-USER. Bumping it would
         * be the easy way to make the test above pass, and it would silently sign this person out
         * of every unrelated household they belong to.
         */
        @Test
        void revokingHereDoesNotTouchTheirOtherHousehold() throws Exception {
            String email = "sam-" + suffix + "@example.com";
            // Sam has their own household first, and a login in Nate's second.
            RegistrationTestSupport.registerAndConfirm(mockMvc, objectMapper, testCodeCache, email, "Sam");
            makeSamAMember();

            revoke(samPersonId, ownerToken).andExpect(status().isNoContent());

            // Signing in still works, and lands them in the household they still belong to.
            JsonNode session = json(mockMvc.perform(post("/api/auth/login")
                    .contentType(MediaType.APPLICATION_JSON)
                    .content(objectMapper.writeValueAsString(
                            Map.of("email", email, "password", "password123"))))
                    .andExpect(status().isOk()));
            assertThat(session.get("token").asText()).isNotBlank();
            assertThat(session.get("membership").get("accountRole").asText()).isEqualTo("OWNER");
        }

        @Test
        void withdrawingAPendingInviteKillsTheLink() throws Exception {
            invite(samPersonId, "sam-" + suffix + "@example.com");
            long inviteId = pendingInviteId(samPersonId);
            String token = plantKnownToken(inviteId);

            revoke(samPersonId, ownerToken).andExpect(status().isNoContent());

            // The emailed link is now worthless -- and answers the same way a wrong token does.
            // 403 rather than 401 so a withdrawn link opened by somebody who happens to be signed
            // in cannot tear their session down; see MembershipInviteService.rejected.
            mockMvc.perform(post("/api/auth/accept-invite")
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(objectMapper.writeValueAsString(Map.of(
                                    "inviteId", inviteId, "token", token, "password", "password123"))))
                    .andExpect(status().isForbidden());
        }

        /**
         * ⚠️ An owner must not be able to remove their own way in. Nothing in the app could put it
         * back, and a household with no owner has nobody left who can invite one.
         */
        @Test
        void anOwnerCannotRemoveTheirOwnLogin() throws Exception {
            long ownPersonId = json(mockMvc.perform(get("/api/auth/me")
                    .header("Authorization", bearer(ownerToken))))
                    .get("membership").get("personId").asLong();

            revoke(ownPersonId, ownerToken).andExpect(status().isConflict());

            // ...and they are still signed in afterwards.
            mockMvc.perform(get("/api/auth/me").header("Authorization", bearer(ownerToken)))
                    .andExpect(status().isOk());
        }

        /**
         * 204, not 404. The owner's intent -- "this person should not have a login" -- is already
         * true, and a 404 would only invite a retry of an action that has nothing left to do.
         */
        @Test
        void revokingSomebodyWithNoLoginSucceedsQuietly() throws Exception {
            revoke(samPersonId, ownerToken).andExpect(status().isNoContent());

            verify(emailService, never()).sendLoginRevoked(anyString(), anyString(), anyString(), anyBoolean());
        }

        @Test
        void aPersonInAnotherHouseholdIs404NotAHint() throws Exception {
            String strangerEmail = "stranger-" + suffix + "@example.com";
            String strangerToken = RegistrationTestSupport
                    .registerAndConfirm(mockMvc, objectMapper, testCodeCache, strangerEmail, "Robin")
                    .get("token").asText();
            long theirPersonId = json(mockMvc.perform(get("/api/auth/me")
                    .header("Authorization", bearer(strangerToken))))
                    .get("membership").get("personId").asLong();

            revoke(theirPersonId, ownerToken).andExpect(status().isNotFound());
        }

        /**
         * ⚠️ The owner is the support desk, and without this they are blind to the single most
         * common reason a member says signing in is broken. Surfaced BESIDE the status rather than
         * as a fourth one: a locked login is still ACTIVE, and clears itself in fifteen minutes.
         */
        @Test
        void aLockedOutMemberIsVisibleToTheOwnerAndCanBeUnlocked() throws Exception {
            String samToken = makeSamAMember();
            String samEmail = "sam-" + suffix + "@example.com";

            // Lock Sam out the way a real person would: forget the password.
            for (int i = 0; i < 10; i++) {
                mockMvc.perform(post("/api/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(
                                Map.of("email", samEmail, "password", "wrong-password"))));
            }

            JsonNode logins = json(mockMvc.perform(get("/api/account/logins")
                    .header("Authorization", bearer(ownerToken))));
            JsonNode sam = logins.get(0).get("personId").asLong() == samPersonId ? logins.get(0) : logins.get(1);

            assertThat(sam.get("lockedUntil").isNull()).isFalse();
            // Still ACTIVE -- a lockout is orthogonal to having a login, not a replacement for it.
            assertThat(sam.get("status").asText()).isEqualTo("ACTIVE");

            mockMvc.perform(post("/api/account/logins/" + samPersonId + "/unlock")
                            .header("Authorization", bearer(ownerToken)))
                    .andExpect(status().isNoContent());

            JsonNode after = json(mockMvc.perform(get("/api/account/logins")
                    .header("Authorization", bearer(ownerToken))));
            JsonNode samAfter = after.get(0).get("personId").asLong() == samPersonId ? after.get(0) : after.get(1);
            assertThat(samAfter.get("lockedUntil").isNull()).isTrue();

            // ...and Sam can actually sign in again, which is the point.
            assertThat(samToken).isNotBlank();
            mockMvc.perform(post("/api/auth/login")
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(objectMapper.writeValueAsString(
                                    Map.of("email", samEmail, "password", "password123"))))
                    .andExpect(status().isOk());
        }

        /**
         * ⚠️ Unlocking GRANTS NOTHING. A lockout is a throttle on guessing, not a credential, so
         * clearing it cannot let the owner in as that member — which is precisely why an owner may
         * do this and may never set a password. The old password must still be the wrong one.
         */
        @Test
        void unlockingDoesNotChangeOrRevealThePassword() throws Exception {
            makeSamAMember();
            String samEmail = "sam-" + suffix + "@example.com";

            for (int i = 0; i < 10; i++) {
                mockMvc.perform(post("/api/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(
                                Map.of("email", samEmail, "password", "wrong-password"))));
            }
            mockMvc.perform(post("/api/account/logins/" + samPersonId + "/unlock")
                            .header("Authorization", bearer(ownerToken)))
                    .andExpect(status().isNoContent());

            // A wrong password is still wrong -- 401, not a session.
            mockMvc.perform(post("/api/auth/login")
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(objectMapper.writeValueAsString(
                                    Map.of("email", samEmail, "password", "wrong-password"))))
                    .andExpect(status().isUnauthorized());
        }

        // Idempotent and quiet: the owner's intent ("let them try again") is already true.
        @Test
        void unlockingSomebodyWhoIsNotLockedIsANoOp() throws Exception {
            makeSamAMember();

            mockMvc.perform(post("/api/account/logins/" + samPersonId + "/unlock")
                            .header("Authorization", bearer(ownerToken)))
                    .andExpect(status().isNoContent());
        }

        @Test
        void aMemberCannotRevokeAnybody() throws Exception {
            String samToken = makeSamAMember();

            revoke(samPersonId, samToken).andExpect(status().isForbidden());
        }

        /**
         * The notice is a security control, not a courtesy: without it somebody is silently signed
         * out, and per {@code offline-internals.md} their queued offline writes can then never
         * land. The two wordings differ, so the flag that picks between them is asserted too.
         */
        @Test
        void aRemovedMemberIsTold() throws Exception {
            makeSamAMember();

            revoke(samPersonId, ownerToken).andExpect(status().isNoContent());

            verify(emailService, timeout(2000)).sendLoginRevoked(
                    eq("sam-" + suffix + "@example.com"), anyString(), eq("Nate"),
                    eq(false));   // false = a real login was removed, not just an invitation
        }

        @Test
        void aWithdrawnInviteSaysSoInsteadOfClaimingALoginWasRemoved() throws Exception {
            invite(samPersonId, "sam-" + suffix + "@example.com");

            revoke(samPersonId, ownerToken).andExpect(status().isNoContent());

            verify(emailService, timeout(2000)).sendLoginRevoked(
                    eq("sam-" + suffix + "@example.com"), anyString(), eq("Nate"),
                    eq(true));    // true = there was never a login, only an invitation
        }
    }

    @Nested
    @DisplayName("acceptance notices")
    class AcceptanceNotices {

        /**
         * ⚠️ THE TYPO DETECTOR, and the reason the owner's notice is a security control rather
         * than a courtesy. A mistyped invite hands a stranger read access to the household's entire
         * training history — visibility is forced ON — and <b>nothing else in the system would ever
         * surface that</b>. The notice has to name the address that actually accepted.
         */
        @Test
        void bothSidesAreToldWhenAnInviteIsAccepted() throws Exception {
            String samEmail = "sam-" + suffix + "@example.com";
            invite(samPersonId, samEmail);
            long inviteId = pendingInviteId(samPersonId);
            String token = plantKnownToken(inviteId);

            mockMvc.perform(post("/api/auth/accept-invite")
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(objectMapper.writeValueAsString(Map.of(
                                    "inviteId", inviteId, "token", token, "password", "password123"))))
                    .andExpect(status().isOk());

            // The member: which household they joined, and who runs it.
            verify(emailService, timeout(2000))
                    .sendAddedToHousehold(eq(samEmail), eq("Sam"), anyString(), eq("Nate"));
            // The owner: WHICH ADDRESS accepted. That argument is the whole point.
            verify(emailService, timeout(2000)).sendInviteAccepted(
                    eq("owner-" + suffix + "@example.com"), eq(samEmail), eq("Sam"), anyString());
        }
    }

}
