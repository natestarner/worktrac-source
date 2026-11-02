package com.worktrac.backend.user;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.worktrac.backend.email.EmailService;
import com.worktrac.backend.support.AbstractIntegrationTest;
import com.worktrac.backend.support.RegistrationTestSupport;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;

// The attempt ceilings are the real defence against guessing -- the in-memory per-email limiters are
// per replica by design (docs/architecture/scaling.md) -- so they must hold when guesses arrive in
// PARALLEL, which is exactly what several replicas (or one attacker with many connections) produce.
//
// Each counter used to be read, compared and incremented in Java: parallel guesses all read the same
// count, all got a BCrypt comparison, and their increments overwrote each other. Each case fires a
// burst of wrong guesses at once and then checks the ceiling still fired: the correct secret, sent
// afterwards, must be refused as locked.
@AutoConfigureMockMvc
class SecurityCounterConcurrencyTest extends AbstractIntegrationTest {

    private static final int PARALLEL_GUESSES = 24;

    @DynamicPropertySource
    static void datasource(DynamicPropertyRegistry registry) {
        registerDatasource(registry, SecurityCounterConcurrencyTest.class);
    }

    @MockitoBean
    private EmailService emailService;

    @Autowired
    private MockMvc mockMvc;

    private final ObjectMapper objectMapper = new ObjectMapper();

    @Autowired
    private TestCodeCache testCodeCache;

    @Autowired
    private UserRepository userRepository;

    private int post(String path, Map<String, String> body, String token) throws Exception {
        var request = org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post(path)
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(body));
        if (token != null) {
            request.header("Authorization", "Bearer " + token);
        }
        return mockMvc.perform(request).andReturn().getResponse().getStatus();
    }

    private void inParallel(int count, Callable<Integer> call) throws Exception {
        ExecutorService pool = Executors.newFixedThreadPool(count);
        CountDownLatch start = new CountDownLatch(1);
        try {
            List<Future<Integer>> results = new ArrayList<>();
            for (int i = 0; i < count; i++) {
                results.add(pool.submit(() -> {
                    start.await();
                    return call.call();
                }));
            }
            start.countDown();
            for (Future<Integer> result : results) {
                result.get(120, TimeUnit.SECONDS);
            }
        } finally {
            pool.shutdownNow();
        }
    }

    private String email(String prefix) {
        return prefix + "-" + UUID.randomUUID().toString().substring(0, 8) + "@example.com";
    }

    @Test
    void parallelWrongPasswordsStillLockTheAccount() throws Exception {
        String email = email("burst-login");
        RegistrationTestSupport.registerAndConfirm(mockMvc, objectMapper, testCodeCache, email, "Sam");

        inParallel(PARALLEL_GUESSES,
                () -> post("/api/auth/login", Map.of("email", email, "password", "wrong-password"), null));

        assertThat(post("/api/auth/login", Map.of("email", email, "password", RegistrationTestSupport.PASSWORD), null))
                .as("%d parallel wrong passwords must lock the account (ceiling %d)", PARALLEL_GUESSES,
                        AuthService.MAX_FAILED_LOGINS)
                .isEqualTo(423);
    }

    @Test
    void parallelWrongCodesStillLockTheRegistration() throws Exception {
        String email = email("burst-confirm");
        post("/api/auth/register", Map.of("email", email, "password", RegistrationTestSupport.PASSWORD,
                "personName", "Kit"), null);
        String code = testCodeCache.get(email);
        String wrong = code.equals("000000") ? "111111" : "000000";

        inParallel(PARALLEL_GUESSES, () -> post("/api/auth/confirm-email", Map.of("email", email, "code", wrong), null));

        assertThat(post("/api/auth/confirm-email", Map.of("email", email, "code", code), null))
                .as("%d parallel wrong codes must lock the registration (ceiling 5)", PARALLEL_GUESSES)
                .isEqualTo(423);
    }

    @Test
    void parallelWrongResetCodesStillLockTheReset() throws Exception {
        String email = email("burst-reset");
        RegistrationTestSupport.registerAndConfirm(mockMvc, objectMapper, testCodeCache, email, "Ash");
        post("/api/auth/forgot-password", Map.of("email", email), null);
        String code = testCodeCache.get(email);
        String wrong = code.equals("000000") ? "111111" : "000000";

        inParallel(PARALLEL_GUESSES, () -> post("/api/auth/reset-password",
                Map.of("email", email, "code", wrong, "password", "new-password-1"), null));

        assertThat(post("/api/auth/reset-password",
                Map.of("email", email, "code", code, "password", "new-password-1"), null))
                .as("%d parallel wrong reset codes must lock the reset (ceiling 5)", PARALLEL_GUESSES)
                .isEqualTo(423);
    }

    // Not a race: the wrong-current-password count was saved and then rolled back by the 403 that
    // followed it, so this ceiling never fired at all.
    @Test
    void wrongCurrentPasswordsOnChangePasswordLockTheAccount() throws Exception {
        String email = email("change-pw");
        String token = RegistrationTestSupport
                .registerAndConfirm(mockMvc, objectMapper, testCodeCache, email, "Lee")
                .get("token").asText();

        for (int i = 0; i < AuthService.MAX_FAILED_LOGINS; i++) {
            assertThat(post("/api/user/password",
                    Map.of("currentPassword", "not-it", "newPassword", "whatever-1"), token)).isEqualTo(403);
        }

        assertThat(post("/api/user/password",
                Map.of("currentPassword", RegistrationTestSupport.PASSWORD, "newPassword", "whatever-1"), token))
                .as("ten wrong current passwords must lock further attempts")
                .isEqualTo(423);
        assertThat(userRepository.findByEmail(email).orElseThrow().getLockedUntil()).isNotNull();
    }
}
