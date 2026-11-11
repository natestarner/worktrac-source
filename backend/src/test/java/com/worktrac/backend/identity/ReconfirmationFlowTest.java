package com.worktrac.backend.identity;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.worktrac.backend.email.EmailService;
import com.worktrac.backend.registrationaudit.RegistrationEventRepository;
import com.worktrac.backend.registrationaudit.RegistrationEventType;
import com.worktrac.backend.support.AbstractIntegrationTest;
import com.worktrac.backend.support.RegistrationTestSupport;
import com.worktrac.backend.user.TestCodeCache;
import com.worktrac.backend.user.User;
import com.worktrac.backend.user.UserRepository;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;

import java.time.Clock;
import java.time.Instant;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * The actions a session alone must not authorize, for a login that has no password: setting its
 * first password, and deleting the account. Each needs a fresh sign-in with a provider connected
 * to THIS login. Plus Apple's server-to-server notifications. End to end through the real routes,
 * with the test identity provider standing in for Apple and Google.
 */
@AutoConfigureMockMvc
@DisplayName("re-confirming with Apple or Google, end to end")
class ReconfirmationFlowTest extends AbstractIntegrationTest {

    @DynamicPropertySource
    static void datasource(DynamicPropertyRegistry registry) {
        registerDatasource(registry, ReconfirmationFlowTest.class);
    }

    @Autowired private MockMvc mockMvc;
    @Autowired private TestIdentityTokens tokens;
    @Autowired private Clock clock;
    @Autowired private TestCodeCache testCodeCache;
    @Autowired private UserRepository userRepository;
    @Autowired private UserIdentityRepository identityRepository;
    @Autowired private RegistrationEventRepository registrationEventRepository;
    @Autowired private AppleNotificationService appleNotificationService;

    @MockitoBean private EmailService emailService;

    private final ObjectMapper objectMapper = new ObjectMapper();

    private static String unique(String prefix) {
        return prefix + "-" + UUID.randomUUID().toString().substring(0, 8);
    }

    private static String newNonce() {
        return UUID.randomUUID() + "-" + UUID.randomUUID();
    }

    private String idToken(String subject, String nonce) {
        Instant now = clock.instant();
        return tokens.mint(subject, null, true, nonce, null, now, now.plusSeconds(600));
    }

    private Map<String, Object> proof(String subject) {
        String nonce = newNonce();
        Map<String, Object> proof = new HashMap<>();
        proof.put("provider", "test");
        proof.put("idToken", idToken(subject, nonce));
        proof.put("nonce", nonce);
        return proof;
    }

    /** A new Apple/Google-style login with no password; returns its session token. */
    private String signUp(String subject, String email) throws Exception {
        String nonce = newNonce();
        Instant now = clock.instant();
        String token = tokens.mint(subject, email, true, nonce, null, now, now.plusSeconds(600));
        return json(mockMvc.perform(post("/api/auth/oauth/test")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of("idToken", token, "nonce", nonce, "personName", "Sam"))))
                .andExpect(status().isOk())).get("token").asText();
    }

    private ResultActions setPassword(String session, String newPassword, Map<String, Object> proof) throws Exception {
        Map<String, Object> body = new HashMap<>();
        body.put("newPassword", newPassword);
        if (proof != null) {
            body.put("reconfirmation", proof);
        }
        return mockMvc.perform(post("/api/user/password/initial")
                .header("Authorization", "Bearer " + session)
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(body)));
    }

    private ResultActions deleteAccount(String session, String password, Map<String, Object> proof) throws Exception {
        Map<String, Object> body = new HashMap<>();
        body.put("confirmationText", "DELETE");
        if (password != null) {
            body.put("password", password);
        }
        if (proof != null) {
            body.put("reconfirmation", proof);
        }
        return mockMvc.perform(delete("/api/account")
                .header("Authorization", "Bearer " + session)
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(body)));
    }

    private ResultActions me(String session) throws Exception {
        return mockMvc.perform(get("/api/auth/me").header("Authorization", "Bearer " + session));
    }

    private ResultActions passwordLogin(String email, String password) throws Exception {
        return mockMvc.perform(post("/api/auth/login")
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(Map.of("email", email, "password", password))));
    }

    private JsonNode json(ResultActions result) throws Exception {
        return objectMapper.readTree(result.andReturn().getResponse().getContentAsString());
    }

    private User user(String email) {
        return userRepository.findByEmail(email).orElseThrow();
    }

    // ── setting a first password ───────────────────────────────────────────────────────────────

    @Nested
    @DisplayName("setting a first password")
    class FirstPassword {

        @Test
        void reconfirmingSetsItSignsOutOtherSessionsAndHandsBackAWorkingOne() throws Exception {
            String email = unique("first") + "@example.com";
            String subject = unique("sub");
            String session = signUp(subject, email);

            String replacement = json(setPassword(session, "my-first-password", proof(subject))
                    .andExpect(status().isOk())).get("token").asText();

            me(replacement).andExpect(status().isOk());
            me(session).andExpect(status().isUnauthorized());
            passwordLogin(email, "my-first-password").andExpect(status().isOk());
            assertThat(user(email).hasPassword()).isTrue();
        }

        // ⚠️ A session proves a device, not a person: setting a password on a borrowed, signed-in
        // phone would be a permanent takeover. Somebody else's valid sign-in proves nothing either.
        @Test
        void somebodyElsesSignInIsRefusedAndNothingChanges() throws Exception {
            String email = unique("first") + "@example.com";
            String session = signUp(unique("sub"), email);
            String otherSubject = unique("other");
            signUp(otherSubject, unique("other") + "@example.com");

            setPassword(session, "attacker-chosen", proof(otherSubject)).andExpect(status().isForbidden());

            assertThat(user(email).hasPassword()).isFalse();
            me(session).andExpect(status().isOk());
        }

        @Test
        void aBadTokenIs403AndTheSessionSurvives() throws Exception {
            String subject = unique("sub");
            String session = signUp(subject, unique("first") + "@example.com");
            Map<String, Object> proof = proof(subject);
            proof.put("nonce", newNonce());

            setPassword(session, "my-first-password", proof).andExpect(status().isForbidden());
            me(session).andExpect(status().isOk());
        }

        @Test
        void withoutAReconfirmationIs400() throws Exception {
            String session = signUp(unique("sub"), unique("first") + "@example.com");
            setPassword(session, "my-first-password", null).andExpect(status().isBadRequest());
        }

        // Replacing a password needs the current one. A provider sign-in must never be a way to
        // overwrite a password that exists -- that would make a compromised Google account a
        // password-reset for this login.
        @Test
        void aLoginThatHasAPasswordIsSentToChangePassword() throws Exception {
            String email = unique("pw") + "@example.com";
            String session = RegistrationTestSupport.registerAndConfirm(mockMvc, objectMapper, testCodeCache, email, "Nate")
                    .get("token").asText();
            String subject = unique("sub");
            String nonce = newNonce();
            mockMvc.perform(post("/api/user/sign-in-methods/test")
                            .header("Authorization", "Bearer " + session)
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(objectMapper.writeValueAsString(Map.of("idToken", idToken(subject, nonce), "nonce", nonce))))
                    .andExpect(status().isOk());

            setPassword(session, "a-replacement", proof(subject)).andExpect(status().isConflict());

            passwordLogin(email, RegistrationTestSupport.PASSWORD).andExpect(status().isOk());
        }
    }

    // ── deleting the account ───────────────────────────────────────────────────────────────────

    @Nested
    @DisplayName("deleting the account")
    class Deleting {

        @Test
        void aLoginWithNoPasswordDeletesByReconfirming() throws Exception {
            String email = unique("del") + "@example.com";
            String subject = unique("sub");
            String session = signUp(subject, email);
            Long userId = user(email).getId();

            deleteAccount(session, null, proof(subject)).andExpect(status().isNoContent());

            assertThat(userRepository.findById(userId)).isEmpty();
            assertThat(identityRepository.findByProviderAndSubject(IdentityProvider.TEST, subject)).isEmpty();
        }

        @Test
        void somebodyElsesSignInDeletesNothing() throws Exception {
            String email = unique("del") + "@example.com";
            String session = signUp(unique("sub"), email);
            String otherSubject = unique("other");
            signUp(otherSubject, unique("other") + "@example.com");

            deleteAccount(session, null, proof(otherSubject)).andExpect(status().isForbidden());

            assertThat(userRepository.findByEmail(email)).isPresent();
            me(session).andExpect(status().isOk());
        }

        @Test
        void withNeitherProofALoginWithNoPasswordIsTold403() throws Exception {
            String session = signUp(unique("sub"), unique("del") + "@example.com");
            deleteAccount(session, null, null)
                    .andExpect(status().isForbidden())
                    .andExpect(jsonPath("$.code").value("NO_PASSWORD"));
            me(session).andExpect(status().isOk());
        }

        // The password field is optional now; a password login that sends nothing still gets the
        // 400 it always did.
        @Test
        void aPasswordLoginThatSendsNoProofIsStill400() throws Exception {
            String email = unique("pw") + "@example.com";
            String session = RegistrationTestSupport.registerAndConfirm(mockMvc, objectMapper, testCodeCache, email, "Nate")
                    .get("token").asText();
            deleteAccount(session, null, null).andExpect(status().isBadRequest());
            assertThat(userRepository.findByEmail(email)).isPresent();
        }

        @Test
        void aPasswordLoginStillDeletesWithItsPassword() throws Exception {
            String email = unique("pw") + "@example.com";
            String session = RegistrationTestSupport.registerAndConfirm(mockMvc, objectMapper, testCodeCache, email, "Nate")
                    .get("token").asText();
            deleteAccount(session, RegistrationTestSupport.PASSWORD, null).andExpect(status().isNoContent());
            assertThat(userRepository.findByEmail(email)).isEmpty();
        }
    }

    // ── Apple's server-to-server notifications ─────────────────────────────────────────────────

    @Nested
    @DisplayName("Apple's notifications")
    class AppleNotifications {

        private Jwt notification(String type, String subject) {
            return Jwt.withTokenValue("verified-elsewhere")
                    .header("alg", "RS256")
                    .claim("iss", "https://appleid.apple.com")
                    .claim("events", "{\"type\":\"" + type + "\",\"sub\":\"" + subject
                            + "\",\"email\":\"x@privaterelay.appleid.com\",\"event_time\":1}")
                    .build();
        }

        /** A password login with an Apple identity linked; returns its session. */
        private String withAppleLinked(String email, String appleSubject) throws Exception {
            String session = RegistrationTestSupport.registerAndConfirm(mockMvc, objectMapper, testCodeCache, email, "Nate")
                    .get("token").asText();
            identityRepository.save(new UserIdentity(user(email), IdentityProvider.APPLE, appleSubject, null, clock.instant()));
            return session;
        }

        @Test
        void consentRevokedDisconnectsAppleAndEndsTheSessionsButKeepsTheHousehold() throws Exception {
            String email = unique("apple") + "@example.com";
            String subject = unique("apple-sub");
            String session = withAppleLinked(email, subject);

            appleNotificationService.handle(notification("consent-revoked", subject));

            assertThat(identityRepository.findByProviderAndSubject(IdentityProvider.APPLE, subject)).isEmpty();
            me(session).andExpect(status().isUnauthorized());
            passwordLogin(email, RegistrationTestSupport.PASSWORD).andExpect(status().isOk());
            assertThat(registrationEventRepository.findAll())
                    .anyMatch(e -> e.getEmail().equals(email) && e.getEventType() == RegistrationEventType.APPLE_CONSENT_REVOKED);
        }

        @Test
        void accountDeleteIsRecordedAsSuch() throws Exception {
            String email = unique("apple") + "@example.com";
            String subject = unique("apple-sub");
            withAppleLinked(email, subject);

            appleNotificationService.handle(notification("account-delete", subject));

            assertThat(registrationEventRepository.findAll())
                    .anyMatch(e -> e.getEmail().equals(email) && e.getEventType() == RegistrationEventType.APPLE_ACCOUNT_DELETED);
        }

        // Apple retries; a second delivery, or one for an identity we never had, is a no-op.
        @Test
        void aRepeatOrUnknownSubjectIsHarmless() throws Exception {
            String email = unique("apple") + "@example.com";
            String subject = unique("apple-sub");
            withAppleLinked(email, subject);

            appleNotificationService.handle(notification("consent-revoked", subject));
            appleNotificationService.handle(notification("consent-revoked", subject));
            appleNotificationService.handle(notification("consent-revoked", "never-linked"));

            passwordLogin(email, RegistrationTestSupport.PASSWORD).andExpect(status().isOk());
        }

        @Test
        void emailDisabledIsRecordedAndChangesNothingElse() throws Exception {
            String email = unique("apple") + "@example.com";
            String subject = unique("apple-sub");
            String session = withAppleLinked(email, subject);

            appleNotificationService.handle(notification("email-disabled", subject));

            assertThat(identityRepository.findByProviderAndSubject(IdentityProvider.APPLE, subject)).isPresent();
            me(session).andExpect(status().isOk());
            assertThat(registrationEventRepository.findAll())
                    .anyMatch(e -> e.getEmail().equals(email) && e.getEventType() == RegistrationEventType.APPLE_EMAIL_DISABLED);
        }

        // Where Apple is not configured (as in these tests) the route does not exist -- and it is
        // reachable without a session, so the answer is 404, not 401.
        @Test
        void theRouteIs404WhereAppleIsNotConfigured() throws Exception {
            mockMvc.perform(post("/api/webhooks/apple-sign-in")
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"payload\":\"x\"}"))
                    .andExpect(status().isNotFound());
        }
    }
}
