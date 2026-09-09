package com.worktrac.backend.user;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.worktrac.backend.email.EmailService;
import com.worktrac.backend.support.AbstractIntegrationTest;
import com.worktrac.backend.support.RegistrationTestSupport;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
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
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Changing your own password from inside a live session.
 *
 * <p>The app had no such screen at all before member logins — "change your password" meant "use
 * forgot-password like everyone else". That was tolerable when a household had one login; it is
 * not once a teenager has their own, because the alternative routes them through an email their
 * parent may well be able to read.
 */
@AutoConfigureMockMvc
@DisplayName("changing your own password")
class ChangePasswordTest extends AbstractIntegrationTest {

    @DynamicPropertySource
    static void datasource(DynamicPropertyRegistry registry) {
        registerDatasource(registry, ChangePasswordTest.class);
    }

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private TestCodeCache testCodeCache;

    @MockitoBean
    private EmailService emailService;

    private final ObjectMapper objectMapper = new ObjectMapper();

    private String token;
    private String email;

    @BeforeEach
    void signIn() throws Exception {
        email = "pw-" + UUID.randomUUID().toString().substring(0, 8) + "@example.com";
        token = RegistrationTestSupport
                .registerAndConfirm(mockMvc, objectMapper, testCodeCache, email, "Nate")
                .get("token").asText();
    }

    private ResultActions change(String current, String next, String withToken) throws Exception {
        return mockMvc.perform(post("/api/user/password")
                .header("Authorization", "Bearer " + withToken)
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(
                        Map.of("currentPassword", current, "newPassword", next))));
    }

    private ResultActions login(String password) throws Exception {
        return mockMvc.perform(post("/api/auth/login")
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(
                        Map.of("email", email, "password", password))));
    }

    @Test
    void theNewPasswordWorksAndTheOldOneDoesNot() throws Exception {
        change("password123", "a-brand-new-one", token).andExpect(status().isOk());

        login("a-brand-new-one").andExpect(status().isOk());
        login("password123").andExpect(status().isUnauthorized());
    }

    /**
     * ⚠️ THE CURRENT PASSWORD IS THE WHOLE POINT OF THIS ROUTE.
     *
     * <p>Without it, a borrowed unlocked phone is a permanent account takeover: whoever holds it
     * sets a password the owner does not know. A live session is proof of a device, not of a
     * person, and this is the one screen where that difference decides everything.
     *
     * <p>⚠️ 403, not 401. This route only 200s with a session token attached, and
     * {@code api/client.js} treats ANY 401 on a token-bearing request as "the session is invalid"
     * and force-signs-out to {@code /login} — correct for a stale/revoked token, wrong here, since
     * the token is fine and it's the current-password field that didn't check out. A 401 silently
     * kicked the person to the login screen with no explanation instead of showing this message;
     * see {@code docs/incidents/2026-09-09-change-password-wrong-current-signs-out.md}.
     */
    @Test
    void aWrongCurrentPasswordIsRefusedAndChangesNothing() throws Exception {
        change("not-my-password", "attacker-chosen", token).andExpect(status().isForbidden());

        login("password123").andExpect(status().isOk());
        login("attacker-chosen").andExpect(status().isUnauthorized());
    }

    /**
     * ⚠️ The caller must not be signed out by their own success.
     *
     * <p>The change bumps token_version, which invalidates every token this user holds — including
     * the one that made the request. Without a replacement in the response the next call 401s, the
     * client tears the session down, and the user lands on the login screen with every reason to
     * think the change failed. So the response is a session, not a 204.
     */
    @Test
    void handsBackAWorkingSessionSoTheCallerStaysSignedIn() throws Exception {
        JsonNode response = objectMapper.readTree(
                change("password123", "a-brand-new-one", token)
                        .andExpect(status().isOk())
                        .andReturn().getResponse().getContentAsString());

        String replacement = response.get("token").asText();
        assertThat(replacement).isNotBlank().isNotEqualTo(token);

        mockMvc.perform(get("/api/auth/me").header("Authorization", "Bearer " + replacement))
                .andExpect(status().isOk());
    }

    /**
     * ⚠️ Every OTHER session must end. Changing a password is very often prompted by the suspicion
     * that somebody else has access; leaving their sessions alive for up to thirty more days, on a
     * screen that implies the opposite, is the failure PasswordResetService already refuses.
     */
    @Test
    void everyOtherSessionIsSignedOut() throws Exception {
        String otherDevice = objectMapper.readTree(
                login("password123").andReturn().getResponse().getContentAsString())
                .get("token").asText();
        // It genuinely worked first, or the assertion below proves nothing.
        mockMvc.perform(get("/api/auth/me").header("Authorization", "Bearer " + otherDevice))
                .andExpect(status().isOk());

        change("password123", "a-brand-new-one", token).andExpect(status().isOk());

        mockMvc.perform(get("/api/auth/me").header("Authorization", "Bearer " + otherDevice))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void aTooShortNewPasswordIsRejected() throws Exception {
        change("password123", "short", token).andExpect(status().isBadRequest());

        login("password123").andExpect(status().isOk());
    }

    @Test
    void thereIsNoWayToDoThisWithoutASession() throws Exception {
        mockMvc.perform(post("/api/user/password")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(
                                Map.of("currentPassword", "password123", "newPassword", "whatever-else"))))
                .andExpect(status().isUnauthorized());
    }

    /**
     * A member changes their own password exactly as an owner does. This is the permission with no
     * owner-only counterpart — see {@code Permission.CHANGE_OWN_PASSWORD} — and the member's
     * Profile page promises it in as many words.
     */
    @Test
    void aMemberCanChangeTheirOwnPasswordToo() throws Exception {
        String memberEmail = "member-" + UUID.randomUUID().toString().substring(0, 8) + "@example.com";
        // The route resolves the person BY NAME within the household, so Sam has to exist first.
        mockMvc.perform(post("/api/people")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of("name", "Sam"))))
                .andExpect(status().isOk());
        // Pro first: member logins are Pro-only, and a paused member 403s on every route.
        mockMvc.perform(post("/api/auth/test/billing-plan")
                        .header("X-E2E-Test-Key", "local-dev-only-e2e-test-key-do-not-use-elsewhere")
                        .param("email", email)
                        .param("plan", "PRO"))
                .andExpect(status().isNoContent());

        mockMvc.perform(post("/api/auth/test/member")
                        .header("X-E2E-Test-Key", "local-dev-only-e2e-test-key-do-not-use-elsewhere")
                        .param("ownerEmail", email)
                        .param("personName", "Sam")
                        .param("memberEmail", memberEmail)
                        .param("password", "password123"))
                .andExpect(status().isNoContent());
        String memberToken = objectMapper.readTree(
                mockMvc.perform(post("/api/auth/login")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(objectMapper.writeValueAsString(
                                        Map.of("email", memberEmail, "password", "password123"))))
                        .andReturn().getResponse().getContentAsString())
                .get("token").asText();

        change("password123", "sams-own-password", memberToken).andExpect(status().isOk());

        mockMvc.perform(post("/api/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(
                                Map.of("email", memberEmail, "password", "sams-own-password"))))
                .andExpect(status().isOk());
        // ...and the OWNER's password is untouched, which is the isolation that matters here.
        login("password123").andExpect(status().isOk());
    }
}
