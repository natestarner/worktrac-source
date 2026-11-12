package com.worktrac.backend.user;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.worktrac.backend.email.EmailService;
import com.worktrac.backend.support.AbstractIntegrationTest;
import com.worktrac.backend.support.EmailTestSupport;
import com.worktrac.backend.support.MutableClock;
import com.worktrac.backend.support.RegistrationTestSupport;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;
import org.springframework.http.MediaType;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

import java.time.Duration;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.Executor;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Sessions are renewed through {@code /me}, so somebody who uses the app is never signed out at the
 * 30-day mark. Sessions used to last exactly 30 days from sign-in however often the app was opened.
 */
@AutoConfigureMockMvc
@TestPropertySource(properties = "app.admin.emails=" + SessionRenewalTest.ADMIN_EMAIL)
class SessionRenewalTest extends AbstractIntegrationTest {

    static final String ADMIN_EMAIL = "renewal-admin@example.com";

    @DynamicPropertySource
    static void datasource(DynamicPropertyRegistry registry) {
        registerDatasource(registry, SessionRenewalTest.class);
    }

    @TestConfiguration
    static class ClockTestConfig {
        @Bean
        @Primary
        MutableClock testClock() {
            return new MutableClock();
        }
    }

    @Autowired private MockMvc mockMvc;
    @Autowired private MutableClock clock;
    @Autowired private TestCodeCache testCodeCache;
    @MockitoBean private EmailService emailService;
    @Autowired @Qualifier("emailTaskExecutor") private Executor emailTaskExecutor;

    private final ObjectMapper objectMapper = new ObjectMapper();

    @BeforeEach
    void realTime() {
        clock.reset();
    }

    @AfterEach
    void letInFlightEmailsFinish() {
        EmailTestSupport.awaitEmailsIdle(emailTaskExecutor);
    }

    private String register(String email) throws Exception {
        return RegistrationTestSupport.registerAndConfirm(mockMvc, objectMapper, testCodeCache, email, "Taylor")
                .get("token").asText();
    }

    private String uniqueEmail() {
        return "renew-" + UUID.randomUUID().toString().substring(0, 8) + "@example.com";
    }

    private JsonNode me(String token) throws Exception {
        String body = mockMvc.perform(get("/api/auth/me").header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        return objectMapper.readTree(body);
    }

    // Jackson renders a JSON null as the text "null", so read it strictly: a missing renewal must
    // fail here, not pass as a token called "null" (which /me would then refuse, vacuously).
    private static String renewedToken(JsonNode me) {
        JsonNode renewed = me.get("renewedToken");
        assertThat(renewed).isNotNull();
        assertThat(renewed.isTextual()).as("renewedToken should be a token, was %s", renewed).isTrue();
        return renewed.asText();
    }

    @Test
    void aTokenUnderADayOldIsNotRenewed() throws Exception {
        String token = register(uniqueEmail());
        clock.advance(Duration.ofHours(23));

        assertThat(me(token).get("renewedToken").isNull()).isTrue();
    }

    @Test
    void aTokenOverADayOldGetsAFreshOneForTheSameHousehold() throws Exception {
        String token = register(uniqueEmail());
        JsonNode before = me(token);
        clock.advance(Duration.ofDays(2));

        String renewed = renewedToken(me(token));
        // Not compared with the old token: JwtService stamps iat/exp from the real time, not this
        // test clock, so inside one real second the two can be byte-identical. In production they are
        // at least a day apart, which is the whole point.
        assertThat(renewed).isNotBlank();

        JsonNode withRenewed = me(renewed);
        assertThat(withRenewed.get("account").get("id")).isEqualTo(before.get("account").get("id"));
        assertThat(withRenewed.get("user").get("email")).isEqualTo(before.get("user").get("email"));
        // Renewing revokes nothing: a second device still holding the old token keeps working.
        me(token);
    }

    @Test
    void aRenewedTokenIsRevokedByAPasswordChangeLikeAnyOther() throws Exception {
        String token = register(uniqueEmail());
        clock.advance(Duration.ofDays(2));
        String renewed = renewedToken(me(token));

        mockMvc.perform(post("/api/user/password")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of(
                                "currentPassword", RegistrationTestSupport.PASSWORD,
                                "newPassword", "a-brand-new-password"))))
                .andExpect(status().isOk());

        mockMvc.perform(get("/api/auth/me").header("Authorization", "Bearer " + renewed))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void anAdminSessionIsNeverRenewed() throws Exception {
        register(ADMIN_EMAIL);
        // The admin role is reconciled at login, from the allowlist.
        String body = mockMvc.perform(post("/api/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of(
                                "email", ADMIN_EMAIL, "password", RegistrationTestSupport.PASSWORD))))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        String adminToken = objectMapper.readTree(body).get("token").asText();
        assertThat(me(adminToken).get("user").get("role").asText()).isEqualTo("ADMIN");
        clock.advance(Duration.ofDays(2));

        assertThat(me(adminToken).get("renewedToken").isNull()).isTrue();
    }
}
