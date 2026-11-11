package com.worktrac.backend.identity;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.worktrac.backend.admin.TestDataCleanupService;
import com.worktrac.backend.email.EmailService;
import com.worktrac.backend.membership.AccountMembershipRepository;
import com.worktrac.backend.membership.AccountRole;
import com.worktrac.backend.registrationaudit.RegistrationEventRepository;
import com.worktrac.backend.registrationaudit.RegistrationEventType;
import com.worktrac.backend.support.AbstractIntegrationTest;
import com.worktrac.backend.support.EmailTestSupport;
import com.worktrac.backend.support.RegistrationTestSupport;
import com.worktrac.backend.user.TestCodeCache;
import com.worktrac.backend.user.User;
import com.worktrac.backend.user.UserRepository;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.Executor;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.Mockito.atLeastOnce;
import static org.mockito.Mockito.clearInvocations;
import static org.mockito.Mockito.verify;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Sign in, sign up, connect and disconnect with Apple or Google, end to end through the real
 * routes, using the test identity provider in place of Apple and Google. Everything after the
 * token -- the matching rules, the account creation, the sessions -- is the production path.
 * {@link IdTokenVerifierTest} covers the token checks themselves against real RSA keys.
 *
 * <p>Design: docs/architecture/social-sign-in.md.
 */
@AutoConfigureMockMvc
@DisplayName("signing in with Apple or Google")
class SocialSignInTest extends AbstractIntegrationTest {

    @DynamicPropertySource
    static void datasource(DynamicPropertyRegistry registry) {
        registerDatasource(registry, SocialSignInTest.class);
    }

    private static final String ADMIN_EMAIL = "nate+huddleadmin@starner.co";
    private static final String TEST_KEY = "local-dev-only-e2e-test-key-do-not-use-elsewhere";

    @Autowired private MockMvc mockMvc;
    @Autowired private TestIdentityTokens tokens;
    @Autowired private Clock clock;
    @Autowired private TestCodeCache testCodeCache;
    @Autowired private UserRepository userRepository;
    @Autowired private UserIdentityRepository identityRepository;
    @Autowired private AccountMembershipRepository membershipRepository;
    @Autowired private RegistrationEventRepository registrationEventRepository;
    @Autowired private TestDataCleanupService testDataCleanupService;
    @Autowired @Qualifier("emailTaskExecutor") private Executor emailTaskExecutor;

    @MockitoBean private EmailService emailService;
    @MockitoSpyBean private PasswordEncoder passwordEncoder;

    private final ObjectMapper objectMapper = new ObjectMapper();

    // ── helpers ────────────────────────────────────────────────────────────────────────────────

    private static String unique(String prefix) {
        return prefix + "-" + UUID.randomUUID().toString().substring(0, 8);
    }

    private static String newNonce() {
        return UUID.randomUUID() + "-" + UUID.randomUUID();
    }

    /** A provider token for this subject/email, bound to {@code nonce}, issued just now. */
    private String idToken(String subject, String email, boolean verified, String nonce) {
        Instant now = clock.instant();
        return tokens.mint(subject, email, verified, nonce, null, now, now.plusSeconds(600));
    }

    private ResultActions signIn(String idToken, String nonce, String personName) throws Exception {
        Map<String, Object> body = new HashMap<>();
        body.put("idToken", idToken);
        body.put("nonce", nonce);
        if (personName != null) {
            body.put("personName", personName);
        }
        return mockMvc.perform(post("/api/auth/oauth/test")
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(body)));
    }

    /** Signs up a brand-new person with the test provider; returns the session token. */
    private String signUp(String subject, String email) throws Exception {
        String nonce = newNonce();
        return json(signIn(idToken(subject, email, true, nonce), nonce, "Sam")
                .andExpect(status().isOk())).get("token").asText();
    }

    private ResultActions connect(String sessionToken, String idToken, String nonce) throws Exception {
        return mockMvc.perform(post("/api/user/sign-in-methods/test")
                .header("Authorization", "Bearer " + sessionToken)
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(Map.of("idToken", idToken, "nonce", nonce))));
    }

    private ResultActions disconnect(String sessionToken) throws Exception {
        return mockMvc.perform(delete("/api/user/sign-in-methods/test")
                .header("Authorization", "Bearer " + sessionToken));
    }

    private ResultActions methods(String sessionToken) throws Exception {
        return mockMvc.perform(get("/api/user/sign-in-methods").header("Authorization", "Bearer " + sessionToken));
    }

    private ResultActions me(String sessionToken) throws Exception {
        return mockMvc.perform(get("/api/auth/me").header("Authorization", "Bearer " + sessionToken));
    }

    private ResultActions passwordLogin(String email, String password) throws Exception {
        return mockMvc.perform(post("/api/auth/login")
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(Map.of("email", email, "password", password))));
    }

    private JsonNode json(ResultActions result) throws Exception {
        return objectMapper.readTree(result.andReturn().getResponse().getContentAsString());
    }

    private String registerWithPassword(String email) throws Exception {
        return RegistrationTestSupport.registerAndConfirm(mockMvc, objectMapper, testCodeCache, email, "Nate")
                .get("token").asText();
    }

    private User user(String email) {
        return userRepository.findByEmail(email).orElseThrow();
    }

    // ── sign up ────────────────────────────────────────────────────────────────────────────────

    @Nested
    @DisplayName("signing up")
    class SigningUp {

        @Test
        void aNewPersonIsAskedForTheirNameFirstAndNothingIsCreatedYet() throws Exception {
            String email = unique("new") + "@example.com";
            String nonce = newNonce();

            signIn(idToken(unique("sub"), email, true, nonce), nonce, null)
                    .andExpect(status().isConflict())
                    .andExpect(jsonPath("$.code").value(SocialSignInService.SIGN_UP_REQUIRED));

            assertThat(userRepository.findByEmail(email)).isEmpty();
        }

        @Test
        void givingANameCreatesAHouseholdTheyOwnWithNoPassword() throws Exception {
            String email = unique("new") + "@example.com";
            String subject = unique("sub");
            String nonce = newNonce();
            String token = idToken(subject, email, true, nonce);

            // The same token twice: the name step resubmits what it already has.
            signIn(token, nonce, null).andExpect(status().isConflict());
            JsonNode response = json(signIn(token, nonce, "Sam").andExpect(status().isOk()));

            assertThat(response.get("token").asText()).isNotBlank();
            assertThat(response.get("person").get("name").asText()).isEqualTo("Sam");
            assertThat(response.get("account").get("name").asText()).isEqualTo("Sam's Household");
            me(response.get("token").asText()).andExpect(status().isOk());

            User user = user(email);
            assertThat(user.hasPassword()).isFalse();
            assertThat(identityRepository.findByProviderAndSubject(IdentityProvider.TEST, subject))
                    .get().extracting(i -> i.getUser().getId()).isEqualTo(user.getId());
            assertThat(membershipRepository.findByUser_IdOrderByCreatedAtAscIdAsc(user.getId()))
                    .singleElement()
                    .extracting(m -> m.getAccountRole()).isEqualTo(AccountRole.OWNER);
            assertThat(registrationEventRepository.findAll())
                    .anyMatch(e -> e.getEmail().equals(email) && e.getEventType() == RegistrationEventType.SOCIAL_SIGN_UP);
        }

        @Test
        void theWelcomeEmailIsSentAsForAnyNewHousehold() throws Exception {
            String email = unique("welcome") + "@example.com";
            signUp(unique("sub"), email);
            EmailTestSupport.awaitEmailsIdle(emailTaskExecutor);
            verify(emailService, atLeastOnce()).sendRegistrationSuccess(email);
        }

        @Test
        void anUnverifiedEmailCannotSignUp() throws Exception {
            String email = unique("unverified") + "@example.com";
            String nonce = newNonce();
            signIn(idToken(unique("sub"), email, false, nonce), nonce, "Sam")
                    .andExpect(status().isForbidden());
            assertThat(userRepository.findByEmail(email)).isEmpty();
        }

        @Test
        void aTokenWithNoEmailCannotSignUp() throws Exception {
            String subject = unique("sub");
            String nonce = newNonce();
            signIn(idToken(subject, null, true, nonce), nonce, "Sam").andExpect(status().isForbidden());
            assertThat(identityRepository.findByProviderAndSubject(IdentityProvider.TEST, subject)).isEmpty();
        }

        // An ADMIN_EMAILS address must never be minted from a provider's say-so.
        @Test
        void theAdminAddressCannotBeSignedUp() throws Exception {
            String subject = unique("sub");
            String nonce = newNonce();
            signIn(idToken(subject, ADMIN_EMAIL, true, nonce), nonce, "Mallory")
                    .andExpect(status().isForbidden());
            assertThat(identityRepository.findByProviderAndSubject(IdentityProvider.TEST, subject)).isEmpty();
        }
    }

    // ── the one rule ───────────────────────────────────────────────────────────────────────────

    /**
     * ⚠️ THE ACCOUNT-TAKEOVER GUARD. A provider identity that is not linked, carrying the email of
     * an existing login, must NOT sign in as that login -- however verified the provider says the
     * email is. It is refused with a pointer to the password, and nothing is linked.
     */
    @Test
    void anUnlinkedIdentityWithAnExistingLoginsEmailIsRefusedAndNotLinked() throws Exception {
        String email = unique("existing") + "@example.com";
        registerWithPassword(email);
        String subject = unique("attacker-sub");
        String nonce = newNonce();

        JsonNode refusal = json(signIn(idToken(subject, email, true, nonce), nonce, "Mallory")
                .andExpect(status().isConflict()));

        assertThat(refusal.has("token")).isFalse();
        assertThat(refusal.get("message").asText()).contains("Sign in with your password");
        assertThat(refusal.has("code")).isFalse();
        assertThat(identityRepository.findByProviderAndSubject(IdentityProvider.TEST, subject)).isEmpty();
        assertThat(identityRepository.countByUser_Id(user(email).getId())).isZero();
    }

    // ── signing back in ────────────────────────────────────────────────────────────────────────

    @Test
    void aReturningPersonIsSignedInAsTheSameLogin() throws Exception {
        String email = unique("back") + "@example.com";
        String subject = unique("sub");
        signUp(subject, email);
        Long userId = user(email).getId();

        String nonce = newNonce();
        JsonNode response = json(signIn(idToken(subject, email, true, nonce), nonce, null).andExpect(status().isOk()));

        assertThat(response.get("user").get("id").asLong()).isEqualTo(userId);
        me(response.get("token").asText()).andExpect(status().isOk());
    }

    // The subject is the identity. A provider-side email change must not lose the login, and must
    // not create a second one.
    @Test
    void aReturningPersonWhoseProviderEmailChangedIsStillTheSameLogin() throws Exception {
        String email = unique("before") + "@example.com";
        String subject = unique("sub");
        signUp(subject, email);

        String nonce = newNonce();
        JsonNode response = json(signIn(idToken(subject, unique("after") + "@example.com", true, nonce), nonce, null)
                .andExpect(status().isOk()));

        assertThat(response.get("user").get("email").asText()).isEqualTo(email);
    }

    @Test
    void signingInRecordsWhenTheIdentityWasLastUsed() throws Exception {
        String subject = unique("sub");
        signUp(subject, unique("used") + "@example.com");
        Instant before = identityRepository.findByProviderAndSubject(IdentityProvider.TEST, subject).orElseThrow().getLastUsedAt();

        String nonce = newNonce();
        signIn(idToken(subject, null, true, nonce), nonce, null).andExpect(status().isOk());

        assertThat(identityRepository.findByProviderAndSubject(IdentityProvider.TEST, subject).orElseThrow().getLastUsedAt())
                .isAfterOrEqualTo(before);
    }

    // ── tokens that prove nothing, through the real route ──────────────────────────────────────

    @Nested
    @DisplayName("a token that proves nothing")
    class BadTokens {

        @Test
        void isA401WithAMessageThatNamesNoCheck() throws Exception {
            String nonce = newNonce();
            JsonNode refusal = json(signIn(idToken(unique("sub"), "x@example.com", true, newNonce()), nonce, "Sam")
                    .andExpect(status().isUnauthorized()));
            assertThat(refusal.get("message").asText()).isEqualTo("We couldn't confirm that Test sign-in. Please try again.");
        }

        @Test
        void aForeignAudienceIsRefused() throws Exception {
            String nonce = newNonce();
            Instant now = clock.instant();
            String token = tokens.mint(unique("sub"), "x@example.com", true, nonce, "another-app", now, now.plusSeconds(600));
            signIn(token, nonce, "Sam").andExpect(status().isUnauthorized());
        }

        @Test
        void aStaleTokenIsRefused() throws Exception {
            String nonce = newNonce();
            Instant issued = clock.instant().minus(Duration.ofMinutes(30));
            String token = tokens.mint(unique("sub"), "x@example.com", true, nonce, null, issued, issued.plus(Duration.ofHours(1)));
            signIn(token, nonce, "Sam").andExpect(status().isUnauthorized());
        }

        @Test
        void aMissingNonceIsA400BeforeAnythingElse() throws Exception {
            mockMvc.perform(post("/api/auth/oauth/test")
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(objectMapper.writeValueAsString(Map.of("idToken", "x"))))
                    .andExpect(status().isBadRequest());
        }
    }

    // ── what is switched off looks like nothing ────────────────────────────────────────────────

    @Test
    void anUnknownProviderAndAnUnconfiguredOneAnswerTheSame404() throws Exception {
        String nonce = newNonce();
        String body = objectMapper.writeValueAsString(Map.of("idToken", idToken("s", "x@example.com", true, nonce), "nonce", nonce));
        // No Apple/Google client ids are configured in tests, so both are unavailable here.
        for (String provider : new String[]{"apple", "google", "facebook"}) {
            mockMvc.perform(post("/api/auth/oauth/" + provider).contentType(MediaType.APPLICATION_JSON).content(body))
                    .andExpect(status().isNotFound());
        }
    }

    @Test
    void theSignInRouteDoesNotWidenToNestedPaths() throws Exception {
        mockMvc.perform(post("/api/auth/oauth/test/anything").contentType(MediaType.APPLICATION_JSON).content("{}"))
                .andExpect(status().isUnauthorized());
    }

    // ── a login with no password ───────────────────────────────────────────────────────────────

    @Nested
    @DisplayName("a login with no password")
    class NoPassword {

        /**
         * ⚠️ Must be indistinguishable from a wrong password: same status, same message, and the
         * same BCrypt work (a skipped comparison answers ~100ms faster, which tells anyone with the
         * sign-in form which addresses use Apple or Google).
         */
        @Test
        void aPasswordSignInFailsExactlyLikeAWrongPasswordIncludingTheBcryptWork() throws Exception {
            String email = unique("nopw") + "@example.com";
            signUp(unique("sub"), email);
            String wrongPasswordMessage = json(passwordLogin(unique("nobody") + "@example.com", "whatever-pw")
                    .andExpect(status().isUnauthorized())).get("message").asText();
            clearInvocations(passwordEncoder);

            JsonNode refusal = json(passwordLogin(email, "any-password-at-all").andExpect(status().isUnauthorized()));

            assertThat(refusal.get("message").asText()).isEqualTo(wrongPasswordMessage);
            verify(passwordEncoder).matches(anyString(), argThat(hash -> hash != null && hash.startsWith("$2a$")));
            assertThat(user(email).getFailedLoginAttempts()).isEqualTo(1);
        }

        @Test
        void changingAPasswordSaysThereIsNoneAndCountsNoFailedAttempt() throws Exception {
            String email = unique("nopw") + "@example.com";
            String token = signUp(unique("sub"), email);

            mockMvc.perform(post("/api/user/password")
                            .header("Authorization", "Bearer " + token)
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(objectMapper.writeValueAsString(Map.of("currentPassword", "guess-guess", "newPassword", "a-new-password"))))
                    .andExpect(status().isForbidden())
                    .andExpect(jsonPath("$.code").value("NO_PASSWORD"));

            assertThat(user(email).getFailedLoginAttempts()).isZero();
            assertThat(user(email).hasPassword()).isFalse();
            me(token).andExpect(status().isOk());
        }

        // Refused with 403 (a 401 would sign them out) until provider re-confirmation exists.
        @Test
        void deletingTheAccountIsRefusedWithoutSigningThemOut() throws Exception {
            String email = unique("nopw") + "@example.com";
            String token = signUp(unique("sub"), email);

            mockMvc.perform(delete("/api/account")
                            .header("Authorization", "Bearer " + token)
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(objectMapper.writeValueAsString(Map.of("confirmationText", "DELETE", "password", "anything"))))
                    .andExpect(status().isForbidden())
                    .andExpect(jsonPath("$.code").value("NO_PASSWORD"));

            me(token).andExpect(status().isOk());
        }

        @Test
        void listsNoPasswordAndTheConnectedProvider() throws Exception {
            String token = signUp(unique("sub"), unique("nopw") + "@example.com");

            methods(token).andExpect(status().isOk())
                    .andExpect(jsonPath("$.hasPassword").value(false))
                    .andExpect(jsonPath("$.connected[0].provider").value("test"))
                    .andExpect(jsonPath("$.connected[0].subject").doesNotExist())
                    .andExpect(jsonPath("$.available[0]").value("test"));
        }
    }

    // ── connecting from a signed-in session ────────────────────────────────────────────────────

    @Nested
    @DisplayName("connecting")
    class Connecting {

        @Test
        void aPasswordLoginCanConnectAndThenSignInWithIt() throws Exception {
            String email = unique("pw") + "@example.com";
            String session = registerWithPassword(email);
            String subject = unique("sub");
            String nonce = newNonce();

            // A different email on the provider side is fine: the person proved both.
            connect(session, idToken(subject, unique("other") + "@gmail.com", true, nonce), nonce)
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.hasPassword").value(true))
                    .andExpect(jsonPath("$.connected[0].provider").value("test"));

            String signInNonce = newNonce();
            JsonNode response = json(signIn(idToken(subject, null, true, signInNonce), signInNonce, null).andExpect(status().isOk()));
            assertThat(response.get("user").get("email").asText()).isEqualTo(email);
        }

        @Test
        void connectingTheSameIdentityTwiceIsHarmless() throws Exception {
            String session = registerWithPassword(unique("pw") + "@example.com");
            String subject = unique("sub");
            String n1 = newNonce();
            String n2 = newNonce();
            connect(session, idToken(subject, "a@example.com", true, n1), n1).andExpect(status().isOk());
            connect(session, idToken(subject, "a@example.com", true, n2), n2).andExpect(status().isOk())
                    .andExpect(jsonPath("$.connected.length()").value(1));
        }

        @Test
        void anIdentityAlreadyOnAnotherLoginIsRefused() throws Exception {
            String subject = unique("sub");
            signUp(subject, unique("first") + "@example.com");
            String session = registerWithPassword(unique("second") + "@example.com");
            String nonce = newNonce();

            connect(session, idToken(subject, "x@example.com", true, nonce), nonce).andExpect(status().isConflict());
        }

        @Test
        void aSecondAccountFromTheSameProviderIsRefused() throws Exception {
            String session = registerWithPassword(unique("pw") + "@example.com");
            String n1 = newNonce();
            String n2 = newNonce();
            connect(session, idToken(unique("sub"), "a@example.com", true, n1), n1).andExpect(status().isOk());
            connect(session, idToken(unique("sub"), "b@example.com", true, n2), n2).andExpect(status().isConflict());
        }

        // ⚠️ 403, never 401: the session is fine, and a 401 would sign the person out over a
        // provider token that had nothing to do with it (backend-core.md).
        @Test
        void aBadProviderTokenIs403AndTheSessionSurvives() throws Exception {
            String session = registerWithPassword(unique("pw") + "@example.com");
            connect(session, idToken(unique("sub"), "a@example.com", true, newNonce()), newNonce())
                    .andExpect(status().isForbidden());
            me(session).andExpect(status().isOk());
        }

        @Test
        void anAdminCannotConnectAndIsOfferedNothing() throws Exception {
            String session = registerWithPassword(ADMIN_EMAIL);
            methods(session).andExpect(status().isOk()).andExpect(jsonPath("$.available.length()").value(0));
            String nonce = newNonce();
            connect(session, idToken(unique("sub"), ADMIN_EMAIL, true, nonce), nonce).andExpect(status().isForbidden());
            assertThat(identityRepository.countByUser_Id(user(ADMIN_EMAIL).getId())).isZero();
        }

        @Test
        void needsASession() throws Exception {
            String nonce = newNonce();
            mockMvc.perform(post("/api/user/sign-in-methods/test")
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(objectMapper.writeValueAsString(Map.of("idToken", idToken("s", "a@example.com", true, nonce), "nonce", nonce))))
                    .andExpect(status().isUnauthorized());
        }
    }

    // ── disconnecting ──────────────────────────────────────────────────────────────────────────

    @Nested
    @DisplayName("disconnecting")
    class Disconnecting {

        @Test
        void signsOutEveryOtherSessionAndHandsBackAWorkingOne() throws Exception {
            String email = unique("pw") + "@example.com";
            String session = registerWithPassword(email);
            String subject = unique("sub");
            String nonce = newNonce();
            connect(session, idToken(subject, "x@example.com", true, nonce), nonce).andExpect(status().isOk());
            String signInNonce = newNonce();
            String viaProvider = json(signIn(idToken(subject, null, true, signInNonce), signInNonce, null)
                    .andExpect(status().isOk())).get("token").asText();

            String replacement = json(disconnect(session).andExpect(status().isOk())).get("token").asText();

            me(replacement).andExpect(status().isOk());
            me(viaProvider).andExpect(status().isUnauthorized());
            me(session).andExpect(status().isUnauthorized());
            assertThat(identityRepository.countByUser_Id(user(email).getId())).isZero();

            // And the provider no longer reaches this login: it is just an unlinked identity whose
            // email may or may not match -- here it does not, so it is a new person.
            String again = newNonce();
            signIn(idToken(subject, null, true, again), again, null).andExpect(status().isForbidden());
        }

        @Test
        void theOnlyWayInCannotBeRemoved() throws Exception {
            String email = unique("nopw") + "@example.com";
            String session = signUp(unique("sub"), email);

            disconnect(session).andExpect(status().isConflict());

            assertThat(identityRepository.countByUser_Id(user(email).getId())).isEqualTo(1);
            me(session).andExpect(status().isOk());
        }

        @Test
        void somethingNotConnectedIs404() throws Exception {
            disconnect(registerWithPassword(unique("pw") + "@example.com")).andExpect(status().isNotFound());
        }
    }

    // ── removing users takes their identities with them ────────────────────────────────────────

    @Test
    void deletingAnAccountRemovesItsLoginsIdentities() throws Exception {
        String email = unique("del") + "@example.com";
        String session = registerWithPassword(email);
        String nonce = newNonce();
        connect(session, idToken(unique("sub"), "x@example.com", true, nonce), nonce).andExpect(status().isOk());
        Long userId = user(email).getId();

        mockMvc.perform(delete("/api/account")
                        .header("Authorization", "Bearer " + session)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(
                                Map.of("confirmationText", "DELETE", "password", RegistrationTestSupport.PASSWORD))))
                .andExpect(status().is2xxSuccessful());

        assertThat(userRepository.findById(userId)).isEmpty();
        assertThat(identityRepository.countByUser_Id(userId)).isZero();
    }

    @Test
    void testDataCleanupRemovesE2eLoginsWithIdentities() throws Exception {
        String email = "huddle+e2e-" + UUID.randomUUID().toString().substring(0, 8) + "@starner.co";
        signUp(unique("sub"), email);
        Long userId = user(email).getId();

        testDataCleanupService.deleteAll();

        assertThat(userRepository.findById(userId)).isEmpty();
        assertThat(identityRepository.countByUser_Id(userId)).isZero();
    }

    // ── the e2e minting route ──────────────────────────────────────────────────────────────────

    @Test
    void theTestMintingRouteNeedsTheKeyAndItsTokensSignIn() throws Exception {
        String nonce = newNonce();
        String body = objectMapper.writeValueAsString(Map.of(
                "subject", unique("sub"), "email", unique("route") + "@example.com", "nonce", nonce));

        mockMvc.perform(post("/api/auth/test/id-token").contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isNotFound());

        String token = json(mockMvc.perform(post("/api/auth/test/id-token")
                        .header("X-E2E-Test-Key", TEST_KEY)
                        .contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isOk())).get("idToken").asText();

        signIn(token, nonce, "Sam").andExpect(status().isOk());
    }
}
