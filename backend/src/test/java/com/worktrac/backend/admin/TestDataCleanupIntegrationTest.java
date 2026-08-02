package com.worktrac.backend.admin;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.worktrac.backend.email.EmailService;
import com.worktrac.backend.registrationaudit.RegistrationEventRepository;
import com.worktrac.backend.support.RegistrationTestSupport;
import com.worktrac.backend.user.PendingRegistrationRepository;
import com.worktrac.backend.user.TestCodeCache;
import com.worktrac.backend.user.UserRepository;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.DefaultApplicationArguments;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.testcontainers.containers.MSSQLServerContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import java.util.Map;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

// Proves the /api/admin/test-data endpoints only ever touch data matching the e2e suite's exact
// email pattern (huddle+e2e-<timestamp>-<random>@starner.co, from e2e/tests/support/auth.ts) --
// specifically that a confirmed e2e-style account, an unconfirmed e2e-style pending
// registration, AND their registration_events all get removed, while a normal-looking account
// (and its own registration_events) and the admin account itself all survive untouched. The
// deeper account-deletion cascade itself (people/exercises/tags/workout data) is already covered
// by AccountDeletionTest; this test's job is only the identification + registration-audit-table
// cleanup this feature adds on top of that.
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("local")
@Testcontainers
@TestPropertySource(properties = "app.admin.emails=" + TestDataCleanupIntegrationTest.ADMIN_EMAIL)
class TestDataCleanupIntegrationTest {

    static final String ADMIN_EMAIL = "admin-cleanup-test@example.com";

    @Container
    @ServiceConnection
    static MSSQLServerContainer<?> sqlServer = new MSSQLServerContainer<>("mcr.microsoft.com/mssql/server:2022-latest")
            .acceptLicense();

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private TestCodeCache testCodeCache;

    @Autowired
    private UserRepository userRepository;

    @Autowired
    private RegistrationEventRepository registrationEventRepository;

    @Autowired
    private PendingRegistrationRepository pendingRegistrationRepository;

    @Autowired
    private com.worktrac.backend.admin.AdminBootstrap adminBootstrap;

    @MockitoBean
    private EmailService emailService;

    private final ObjectMapper objectMapper = new ObjectMapper();

    // Deliberately mirrors e2e/tests/support/auth.ts's exact pattern -- this is the one and only
    // format TestDataCleanupService is designed to match.
    private String e2eStyleEmail() {
        return "huddle+e2e-" + System.currentTimeMillis() + "-" + UUID.randomUUID() + "@starner.co";
    }

    private String registerBody(String email, String personName) throws Exception {
        return objectMapper.writeValueAsString(Map.of(
                "email", email, "password", "password123", "personName", personName));
    }

    // Idempotent: two @Test methods in this class both need an admin token, and JUnit doesn't
    // guarantee method order (no @TestMethodOrder here) -- registering ADMIN_EMAIL a second time
    // would 409 as a duplicate, so only register once per class run.
    private String adminToken() throws Exception {
        if (userRepository.findByEmail(ADMIN_EMAIL).isEmpty()) {
            RegistrationTestSupport.registerAndConfirm(mockMvc, objectMapper, testCodeCache, ADMIN_EMAIL, "Admin");
            adminBootstrap.run(new DefaultApplicationArguments());
        }
        String loginBody = objectMapper.writeValueAsString(Map.of("email", ADMIN_EMAIL, "password", "password123"));
        String response = mockMvc.perform(post("/api/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(loginBody))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        return objectMapper.readTree(response).get("token").asText();
    }

    @Test
    void previewAndDeleteOnlyTouchDataMatchingTheE2ePattern() throws Exception {
        String token = adminToken();

        String confirmedTestEmail = e2eStyleEmail();
        String unconfirmedTestEmail = e2eStyleEmail();
        String realEmail = "realuser-" + UUID.randomUUID() + "@example.com";

        RegistrationTestSupport.registerAndConfirm(mockMvc, objectMapper, testCodeCache, confirmedTestEmail, "TestOne");
        mockMvc.perform(post("/api/auth/register")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(registerBody(unconfirmedTestEmail, "TestTwo")))
                .andExpect(status().isOk());
        RegistrationTestSupport.registerAndConfirm(mockMvc, objectMapper, testCodeCache, realEmail, "RealUser");

        // Preview must count exactly the one confirmed e2e-style account (the unconfirmed one
        // never became a User row) plus both e2e-style pending/confirmed registrations' events,
        // and the one still-pending e2e-style registration -- never the real account or admin.
        String previewResponse = mockMvc.perform(get("/api/admin/test-data/preview")
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.accountCount").value(1))
                .andExpect(jsonPath("$.pendingRegistrationCount").value(1))
                .andReturn().getResponse().getContentAsString();
        long previewedEventCount = objectMapper.readTree(previewResponse).get("registrationEventCount").asLong();
        assertTrue(previewedEventCount > 0, "expected at least the confirmed test account's own events");

        mockMvc.perform(delete("/api/admin/test-data")
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.accountCount").value(1))
                .andExpect(jsonPath("$.pendingRegistrationCount").value(1))
                .andExpect(jsonPath("$.registrationEventCount").value(previewedEventCount));

        // Both e2e-style identities are fully gone...
        assertTrue(userRepository.findByEmail(confirmedTestEmail).isEmpty());
        assertTrue(pendingRegistrationRepository.findByEmail(unconfirmedTestEmail).isEmpty());
        assertTrue(registrationEventRepository.findTop500ByOrderByCreatedAtDesc().stream()
                .noneMatch(e -> e.getEmail().equals(confirmedTestEmail) || e.getEmail().equals(unconfirmedTestEmail)));

        // ...while the real account and the admin account are both completely untouched.
        assertTrue(userRepository.findByEmail(realEmail).isPresent());
        assertTrue(userRepository.findByEmail(ADMIN_EMAIL).isPresent());
        assertTrue(registrationEventRepository.findTop500ByOrderByCreatedAtDesc().stream()
                .anyMatch(e -> e.getEmail().equals(realEmail)),
                "the real account's own registration history must survive");

        // And a second preview now reports nothing left to clean up.
        mockMvc.perform(get("/api/admin/test-data/preview")
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.accountCount").value(0))
                .andExpect(jsonPath("$.pendingRegistrationCount").value(0));
    }

    // Regression coverage for the bulk-delete rewrite: the previous implementation looped
    // AccountDeletionService.deleteAccount(Long) once per matching account, which was slow
    // enough at real lower-environment scale (hundreds of accumulated e2e accounts) to exceed
    // the frontend's request timeout. This proves the new bulk `DELETE ... WHERE account_id IN
    // (...)` path still correctly removes every one of several accounts in a single call, not
    // just the single-account case the other test above already covered.
    @Test
    void deletesEveryMatchingAccountAtOnce() throws Exception {
        String token = adminToken();

        String[] testEmails = {e2eStyleEmail(), e2eStyleEmail(), e2eStyleEmail()};
        for (int i = 0; i < testEmails.length; i++) {
            RegistrationTestSupport.registerAndConfirm(mockMvc, objectMapper, testCodeCache, testEmails[i],
                    "Bulk" + i);
        }

        mockMvc.perform(get("/api/admin/test-data/preview")
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.accountCount").value(3));

        mockMvc.perform(delete("/api/admin/test-data")
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.accountCount").value(3));

        for (String email : testEmails) {
            assertTrue(userRepository.findByEmail(email).isEmpty(), email + " should have been deleted");
        }
        assertTrue(userRepository.findByEmail(ADMIN_EMAIL).isPresent(), "the admin account must survive");
    }

    @Test
    void unauthenticatedAndNonAdminRequestsAreRejected() throws Exception {
        mockMvc.perform(get("/api/admin/test-data/preview")).andExpect(status().isUnauthorized());
        mockMvc.perform(delete("/api/admin/test-data")).andExpect(status().isUnauthorized());

        String plainEmail = "plain-cleanup-test-" + UUID.randomUUID() + "@example.com";
        String plainToken = RegistrationTestSupport
                .registerAndConfirm(mockMvc, objectMapper, testCodeCache, plainEmail, "Plain")
                .get("token").asText();

        mockMvc.perform(get("/api/admin/test-data/preview").header("Authorization", "Bearer " + plainToken))
                .andExpect(status().isForbidden());
        mockMvc.perform(delete("/api/admin/test-data").header("Authorization", "Bearer " + plainToken))
                .andExpect(status().isForbidden());
    }
}
