package com.worktrac.backend.user;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.worktrac.backend.config.EmailProperties;
import com.worktrac.backend.email.EmailService;
import com.worktrac.backend.support.MutableClock;
import com.worktrac.backend.support.RegistrationTestSupport;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.testcontainers.containers.MSSQLServerContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import java.time.Duration;
import java.util.Map;
import java.util.UUID;

import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.timeout;
import static org.mockito.Mockito.verify;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

// "local" is activated so app.jwt.secret resolves to the dev-only secret in
// application-local.yml -- see AuthControllerTest for the full reasoning (identical setup, so
// Spring reuses the same cached application context across both test classes).
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("local")
@Testcontainers
class PasswordResetControllerTest {

    @Container
    @ServiceConnection
    static MSSQLServerContainer<?> sqlServer = new MSSQLServerContainer<>("mcr.microsoft.com/mssql/server:2022-latest")
            .acceptLicense();

    @TestConfiguration
    static class ClockTestConfig {
        @Bean
        @Primary
        MutableClock testClock() {
            return new MutableClock();
        }
    }

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private MutableClock clock;

    @Autowired
    private TestCodeCache testCodeCache;

    @Autowired
    private EmailProperties emailProperties;

    @MockitoBean
    private EmailService emailService;

    private final ObjectMapper objectMapper = new ObjectMapper();

    private String uniqueEmail(String label) {
        return label + "-" + UUID.randomUUID().toString().substring(0, 8) + "@example.com";
    }

    private String registerRealUser(String label, String personName) throws Exception {
        String email = uniqueEmail(label);
        RegistrationTestSupport.registerAndConfirm(mockMvc, objectMapper, testCodeCache, email, personName);
        return email;
    }

    private void requestReset(String email) throws Exception {
        String body = objectMapper.writeValueAsString(Map.of("email", email));
        mockMvc.perform(post("/api/auth/forgot-password")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isOk());
    }

    private void assertLoginResult(String email, String password, boolean shouldSucceed) throws Exception {
        String body = objectMapper.writeValueAsString(Map.of("email", email, "password", password));
        mockMvc.perform(post("/api/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().is(shouldSucceed ? 200 : 401));
    }

    @Test
    void forgotPasswordForKnownEmailSendsACode() throws Exception {
        String email = registerRealUser("known", "Alex");

        requestReset(email);

        verify(emailService, timeout(2000)).sendPasswordResetCode(eq(email), anyString());
    }

    // The core non-enumeration guarantee: an email with no account must get the exact same 200
    // response as a real one, and must never trigger an actual send.
    @Test
    void forgotPasswordForUnknownEmailReturns200AndSendsNothing() throws Exception {
        String email = uniqueEmail("unknown");

        requestReset(email);

        verify(emailService, never()).sendPasswordResetCode(anyString(), anyString());
    }

    @Test
    void resetWithValidCodeChangesThePasswordAndLogsInWithTheNewOne() throws Exception {
        String email = registerRealUser("reset", "Jordan");
        requestReset(email);
        String code = testCodeCache.get(email);

        String resetBody = objectMapper.writeValueAsString(Map.of("email", email, "code", code, "password", "newpassword456"));
        mockMvc.perform(post("/api/auth/reset-password")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(resetBody))
                .andExpect(status().isOk());

        assertLoginResult(email, "password123", false);
        assertLoginResult(email, "newpassword456", true);

        verify(emailService, timeout(2000)).sendPasswordResetSuccess(email);
    }

    @Test
    void resetSucceedsEvenWhenTheSuccessEmailSendFails() throws Exception {
        String email = registerRealUser("emailfails", "Drew");
        doThrow(new RuntimeException("ACS unavailable")).when(emailService).sendPasswordResetSuccess(email);
        requestReset(email);
        String code = testCodeCache.get(email);

        String resetBody = objectMapper.writeValueAsString(Map.of("email", email, "code", code, "password", "newpassword456"));
        mockMvc.perform(post("/api/auth/reset-password")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(resetBody))
                .andExpect(status().isOk());

        assertLoginResult(email, "newpassword456", true);
        verify(emailService, timeout(2000)).sendPasswordResetSuccess(email);
    }

    @Test
    void resetWithNoOutstandingCodeReturns401WithoutRevealingWhy() throws Exception {
        String email = registerRealUser("nocode", "Sam");

        String resetBody = objectMapper.writeValueAsString(Map.of("email", email, "code", "123456", "password", "newpassword456"));
        mockMvc.perform(post("/api/auth/reset-password")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(resetBody))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void resetWithExpiredCodeReturns410() throws Exception {
        String email = registerRealUser("expired", "Taylor");
        requestReset(email);
        String code = testCodeCache.get(email);

        clock.advance(Duration.ofMinutes(16));

        String resetBody = objectMapper.writeValueAsString(Map.of("email", email, "code", code, "password", "newpassword456"));
        mockMvc.perform(post("/api/auth/reset-password")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(resetBody))
                .andExpect(status().isGone());
    }

    @Test
    void wrongCodeFiveTimesLocksOutEvenTheCorrectCode() throws Exception {
        String email = registerRealUser("lockout", "Morgan");
        requestReset(email);

        String wrongBody = objectMapper.writeValueAsString(Map.of("email", email, "code", "000000", "password", "newpassword456"));
        for (int i = 0; i < 5; i++) {
            mockMvc.perform(post("/api/auth/reset-password")
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(wrongBody))
                    .andExpect(status().isUnauthorized());
        }

        String correctCode = testCodeCache.get(email);
        String correctBody = objectMapper.writeValueAsString(Map.of("email", email, "code", correctCode, "password", "newpassword456"));
        mockMvc.perform(post("/api/auth/reset-password")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(correctBody))
                .andExpect(status().isLocked());
    }

    @Test
    void resendResetCodeWithinCooldownReturns429() throws Exception {
        String email = registerRealUser("resend", "Casey");
        requestReset(email);

        String resendBody = objectMapper.writeValueAsString(Map.of("email", email));
        mockMvc.perform(post("/api/auth/resend-reset-code")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(resendBody))
                .andExpect(status().isTooManyRequests());
    }

    @Test
    void resendResetCodeAfterCooldownDeliversAWorkingCode() throws Exception {
        String email = registerRealUser("resendok", "Riley");
        requestReset(email);
        String firstCode = testCodeCache.get(email);

        clock.advance(Duration.ofSeconds(61));

        String resendBody = objectMapper.writeValueAsString(Map.of("email", email));
        mockMvc.perform(post("/api/auth/resend-reset-code")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(resendBody))
                .andExpect(status().isOk());

        String secondCode = testCodeCache.get(email);
        org.junit.jupiter.api.Assertions.assertNotEquals(firstCode, secondCode,
                "resend should issue a fresh code, not repeat the old one");

        String resetBody = objectMapper.writeValueAsString(Map.of("email", email, "code", secondCode, "password", "newpassword456"));
        mockMvc.perform(post("/api/auth/reset-password")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(resetBody))
                .andExpect(status().isOk());
    }

    // Mirrors resendResetCode's non-enumerating contract: silently returning 200 rather than a
    // distinguishable error keeps "no reset outstanding" indistinguishable from "unknown email".
    @Test
    void resendResetCodeWithNoOutstandingResetReturns200() throws Exception {
        String email = registerRealUser("noresend", "Quinn");

        String resendBody = objectMapper.writeValueAsString(Map.of("email", email));
        mockMvc.perform(post("/api/auth/resend-reset-code")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(resendBody))
                .andExpect(status().isOk());

        verify(emailService, never()).sendPasswordResetCode(anyString(), anyString());
    }
}
