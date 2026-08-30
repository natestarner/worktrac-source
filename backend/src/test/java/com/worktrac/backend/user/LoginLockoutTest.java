package com.worktrac.backend.user;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.worktrac.backend.email.EmailService;
import com.worktrac.backend.support.AbstractIntegrationTest;
import com.worktrac.backend.support.MutableClock;
import com.worktrac.backend.support.RegistrationTestSupport;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;
import org.springframework.http.MediaType;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

import java.time.Duration;
import java.util.Map;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

// POST /api/auth/login had no throttle of any kind before this: no per-IP cap, no per-account cap,
// no lockout. Passwords could be tried as fast as the network allowed.
//
// Own Spring context with the per-IP login limit raised out of the way, so this class observes the
// LOCKOUT rather than the rate limiter. The two defend different shapes -- one account being
// guessed, versus one source flooding -- and a test that cannot tell them apart proves neither.
//
// MutableClock is what makes "temporary" testable without a fifteen-minute wait, the same way
// RestSecondsTest and WorkoutSessionAutocloseTest use it.
@SpringBootTest(properties = {
        "app.rate-limit.login-per-ip-per-hour=100000",
        "app.rate-limit.login-global-per-hour=100000"
})
@AutoConfigureMockMvc
class LoginLockoutTest extends AbstractIntegrationTest {

    private static final int MAX_FAILED_LOGINS = 10;

    @DynamicPropertySource
    static void datasource(DynamicPropertyRegistry registry) {
        registerDatasource(registry, LoginLockoutTest.class);
    }

    @TestConfiguration
    static class ClockConfig {
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

    @MockitoBean
    private EmailService emailService;

    private final ObjectMapper objectMapper = new ObjectMapper();

    private JsonNode register(String email) throws Exception {
        return RegistrationTestSupport.registerAndConfirm(mockMvc, objectMapper, testCodeCache, email, "Casey");
    }

    private int attemptLogin(String email, String password) throws Exception {
        return mockMvc.perform(post("/api/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of("email", email, "password", password))))
                .andReturn().getResponse().getStatus();
    }

    private String uniqueEmail(String prefix) {
        return prefix + "-" + UUID.randomUUID().toString().substring(0, 8) + "@example.com";
    }

    @Test
    void repeatedWrongPasswordsLockTheAccount() throws Exception {
        String email = uniqueEmail("lockout");
        register(email);

        for (int attempt = 1; attempt <= MAX_FAILED_LOGINS; attempt++) {
            assertEquals(401, attemptLogin(email, "wrong-password"),
                    "attempt " + attempt + " should read as an ordinary rejection");
        }

        // Now locked: even the CORRECT password is refused, which is what makes this a real guard
        // rather than a counter nobody reads.
        assertEquals(423, attemptLogin(email, RegistrationTestSupport.PASSWORD));
    }

    // The lockout is temporary BY DESIGN -- locked_until is a timestamp, not a flag. It expires on
    // its own with no admin action and no unlock endpoint, so a family member who fat-fingers their
    // password is back in without needing anyone.
    @Test
    void theLockoutExpiresOnItsOwn() throws Exception {
        String email = uniqueEmail("lockexpiry");
        register(email);

        for (int attempt = 0; attempt < MAX_FAILED_LOGINS; attempt++) {
            attemptLogin(email, "wrong-password");
        }
        assertEquals(423, attemptLogin(email, RegistrationTestSupport.PASSWORD), "should be locked to begin with");

        clock.advance(Duration.ofMinutes(16));

        assertEquals(200, attemptLogin(email, RegistrationTestSupport.PASSWORD),
                "the lock must lift by the clock alone");
    }

    // The other half of what makes lockout acceptable on a shared household login: being locked out
    // is indistinguishable from having forgotten the password, so the instinctive response --
    // resetting it -- has to let them straight back in. Without this they would reset successfully
    // and then still be refused, holding a password that now works.
    @Test
    void aPasswordResetUnlocksImmediately() throws Exception {
        String email = uniqueEmail("lockreset");
        register(email);

        for (int attempt = 0; attempt < MAX_FAILED_LOGINS; attempt++) {
            attemptLogin(email, "wrong-password");
        }
        assertEquals(423, attemptLogin(email, RegistrationTestSupport.PASSWORD), "should be locked to begin with");

        mockMvc.perform(post("/api/auth/forgot-password")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of("email", email))))
                .andExpect(status().isOk());
        String resetCode = testCodeCache.get(email);

        String newPassword = "brand-new-password-123";
        mockMvc.perform(post("/api/auth/reset-password")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of(
                                "email", email, "code", resetCode, "password", newPassword))))
                .andExpect(status().isOk());

        // No clock advance: the reset alone must clear it, right now.
        assertEquals(200, attemptLogin(email, newPassword));
    }

    @Test
    void aSuccessfulLoginClearsTheFailureCount() throws Exception {
        String email = uniqueEmail("lockclear");
        register(email);

        for (int attempt = 0; attempt < MAX_FAILED_LOGINS - 1; attempt++) {
            attemptLogin(email, "wrong-password");
        }
        assertEquals(200, attemptLogin(email, RegistrationTestSupport.PASSWORD));

        // The counter reset means the next run of wrong attempts starts from zero rather than
        // locking on the very next one.
        assertEquals(401, attemptLogin(email, "wrong-password"));
        assertEquals(200, attemptLogin(email, RegistrationTestSupport.PASSWORD));
    }

    // An unknown email must cost the same as a known one. Returning early skipped BCrypt entirely,
    // answering in about a millisecond instead of a hundred -- a timing oracle that, with no rate
    // limit in front of it, let anyone enumerate the whole user base at speed. Asserting on timing
    // directly would be flaky; what is pinned here is that the response is indistinguishable.
    @Test
    void anUnknownEmailIsRejectedTheSameWayAsAWrongPassword() throws Exception {
        String email = uniqueEmail("known");
        register(email);

        assertEquals(401, attemptLogin(email, "wrong-password"));
        assertEquals(401, attemptLogin(uniqueEmail("never-registered"), "wrong-password"));
    }
}
