package com.worktrac.backend.user;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.worktrac.backend.email.EmailService;
import com.worktrac.backend.support.AbstractIntegrationTest;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

// Isolated Spring context with its own low limit, the pattern AuthControllerRateLimitTest and
// ContactRateLimitTest already use and application-local.yml documents: the shared suite runs with
// the limits raised to a ceiling no test can reach, so a class that wants to observe a 429 has to
// bring its own.
//
// This bounds a DIFFERENT thing from the per-account lockout in LoginLockoutTest. The lockout stops
// one household being guessed at; it does nothing about an attacker spraying one common password
// across many accounts, or about the CPU cost of the attempt itself -- every login runs a BCrypt
// verification (~100ms), so on the order of ten requests a second saturates a vCPU. That is why the
// bucket is consumed BEFORE the user lookup and before any hashing, and why these requests use an
// email that was never registered: the limit must bite without the server doing the expensive work.
@SpringBootTest(properties = {
        "app.rate-limit.login-per-ip-per-hour=2",
        "app.rate-limit.login-global-per-hour=100000"
})
@AutoConfigureMockMvc
class LoginRateLimitTest extends AbstractIntegrationTest {

    @DynamicPropertySource
    static void datasource(DynamicPropertyRegistry registry) {
        registerDatasource(registry, LoginRateLimitTest.class);
    }

    @Autowired
    private MockMvc mockMvc;

    @MockitoBean
    private EmailService emailService;

    private final ObjectMapper objectMapper = new ObjectMapper();

    private int attemptLogin() throws Exception {
        return mockMvc.perform(post("/api/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(
                                Map.of("email", "nobody@example.com", "password", "whatever"))))
                .andReturn().getResponse().getStatus();
    }

    @Test
    void repeatedLoginAttemptsFromOneAddressAreThrottled() throws Exception {
        assertEquals(401, attemptLogin());
        assertEquals(401, attemptLogin());

        // 429 rather than another 401: the bucket is spent, and this one never reached the lookup.
        assertEquals(429, attemptLogin());
    }
}
