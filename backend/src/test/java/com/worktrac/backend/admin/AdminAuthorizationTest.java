package com.worktrac.backend.admin;

import com.worktrac.backend.support.AbstractIntegrationTest;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.worktrac.backend.email.EmailService;
import com.worktrac.backend.billing.BillingEvent;
import com.worktrac.backend.billing.BillingEventRepository;
import com.worktrac.backend.billing.BillingEventType;
import com.worktrac.backend.support.RegistrationTestSupport;
import com.worktrac.backend.user.TestCodeCache;
import com.worktrac.backend.user.User;
import com.worktrac.backend.user.UserRepository;
import org.junit.jupiter.api.MethodOrderer;
import org.junit.jupiter.api.Order;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestMethodOrder;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.DefaultApplicationArguments;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

// Covers the whole admin RBAC surface in one Spring context/container (rather than one
// per concern) to keep CI runtime down -- see the "Test suite parallelization" pattern
// already established across this test suite. Methods are ordered because @Order(1)
// establishes the one admin identity every later test reuses (ADMIN_EMAIL can only be
// registered/confirmed once per running container, so it can't be repeated per method
// the way uniqueEmail() lets ordinary users be).
@AutoConfigureMockMvc
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
@TestPropertySource(properties = "app.admin.emails=" + AdminAuthorizationTest.ADMIN_EMAIL)
class AdminAuthorizationTest extends AbstractIntegrationTest {

    @DynamicPropertySource
    static void datasource(DynamicPropertyRegistry registry) {
        registerDatasource(registry, AdminAuthorizationTest.class);
    }

    static final String ADMIN_EMAIL = "admin-portal-test@example.com";

    private static final String[] ADMIN_ROUTES = {
            "/api/admin/overview", "/api/admin/accounts", "/api/admin/people",
            "/api/admin/pending-registrations", "/api/admin/health",
            "/api/admin/registration-events", "/api/admin/registration-alert-settings",
            "/api/admin/contact-messages"
    };

    // Real EmailService constructor builds a live Azure EmailClient -- mocked out so
    // registering test users never depends on a real ACS resource.
    @MockitoBean
    private EmailService emailService;

    @Autowired
    private BillingEventRepository billingEventRepository;

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private TestCodeCache testCodeCache;

    @Autowired
    private UserRepository userRepository;

    @Autowired
    private AdminBootstrap adminBootstrap;

    private final ObjectMapper objectMapper = new ObjectMapper();

    private static String adminToken;

    private String uniqueEmail(String label) {
        return label + "-" + UUID.randomUUID().toString().substring(0, 8) + "@example.com";
    }

    private String login(String email, String password) throws Exception {
        String body = objectMapper.writeValueAsString(Map.of("email", email, "password", password));
        String response = mockMvc.perform(post("/api/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        return objectMapper.readTree(response).get("token").asText();
    }

    @Test
    @Order(1)
    void bootstrapPromotesAlreadyRegisteredAdminAllowlistedUser() throws Exception {
        RegistrationTestSupport.registerAndConfirm(mockMvc, objectMapper, testCodeCache, ADMIN_EMAIL, "Admin");

        // confirmEmail never reconciles role -- only AuthService.login and AdminBootstrap do.
        User beforeBootstrap = userRepository.findByEmail(ADMIN_EMAIL).orElseThrow();
        assertEquals("USER", beforeBootstrap.getRole());

        adminBootstrap.run(new DefaultApplicationArguments());

        User afterBootstrap = userRepository.findByEmail(ADMIN_EMAIL).orElseThrow();
        assertEquals("ADMIN", afterBootstrap.getRole());

        // Mint a token reflecting the promoted role, reused by every later test in this class.
        adminToken = login(ADMIN_EMAIL, "password123");
    }

    @Test
    @Order(2)
    void unauthenticatedRequestsReturn401ForEveryAdminRoute() throws Exception {
        for (String route : ADMIN_ROUTES) {
            mockMvc.perform(get(route)).andExpect(status().isUnauthorized());
        }
    }

    @Test
    @Order(3)
    void nonAdminUserReceives403ForEveryAdminRoute() throws Exception {
        String email = uniqueEmail("plain-user");
        String token = RegistrationTestSupport.registerAndConfirm(mockMvc, objectMapper, testCodeCache, email, "Plain")
                .get("token").asText();

        for (String route : ADMIN_ROUTES) {
            mockMvc.perform(get(route).header("Authorization", "Bearer " + token))
                    .andExpect(status().isForbidden());
        }
    }

    @Test
    @Order(4)
    void adminCanReachOverviewAccountsPeopleAndHealth() throws Exception {
        mockMvc.perform(get("/api/admin/overview").header("Authorization", "Bearer " + adminToken))
                .andExpect(status().isOk());

        String accountsResponse = mockMvc.perform(get("/api/admin/accounts").header("Authorization", "Bearer " + adminToken))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        assertTrue(accountsResponse.contains(ADMIN_EMAIL));
        assertTrue(accountsResponse.contains("\"role\":\"ADMIN\""));

        String peopleResponse = mockMvc.perform(get("/api/admin/people").header("Authorization", "Bearer " + adminToken))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        assertTrue(peopleResponse.contains("Admin"));
        assertTrue(peopleResponse.contains(ADMIN_EMAIL));

        mockMvc.perform(get("/api/admin/health").header("Authorization", "Bearer " + adminToken))
                .andExpect(status().isOk());
    }

    @Test
    @Order(5)
    void pendingRegistrationSurfacesInAdminListWithoutLeakingHashes() throws Exception {
        String email = uniqueEmail("still-pending");
        String registerBody = objectMapper.writeValueAsString(Map.of(
                "email", email, "password", "password123", "personName", "Pending"));
        mockMvc.perform(post("/api/auth/register")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(registerBody))
                .andExpect(status().isOk());

        String response = mockMvc.perform(get("/api/admin/pending-registrations")
                        .header("Authorization", "Bearer " + adminToken))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();

        assertTrue(response.contains(email));
        assertFalse(response.contains("passwordHash"));
        assertFalse(response.contains("codeHash"));
    }

    @Test
    @Order(6)
    void crossAccountVisibilityAcrossMultipleHouseholds() throws Exception {
        String emailA = uniqueEmail("household-a");
        String emailB = uniqueEmail("household-b");
        RegistrationTestSupport.registerAndConfirm(mockMvc, objectMapper, testCodeCache, emailA, "Alex");
        RegistrationTestSupport.registerAndConfirm(mockMvc, objectMapper, testCodeCache, emailB, "Blair");

        String accountsResponse = mockMvc.perform(get("/api/admin/accounts").header("Authorization", "Bearer " + adminToken))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();

        // Proves the admin endpoint bypasses the normal per-account scoping that keeps
        // one household from ever seeing another's data (see MultiTenancyIsolationTest).
        assertTrue(accountsResponse.contains(emailA));
        assertTrue(accountsResponse.contains(emailB));
        assertFalse(accountsResponse.contains("passwordHash"));

        String peopleResponse = mockMvc.perform(get("/api/admin/people").header("Authorization", "Bearer " + adminToken))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        assertTrue(peopleResponse.contains("Alex"));
        assertTrue(peopleResponse.contains("Blair"));
    }

    @Test
    @Order(7)
    void loginDemotesUserNoLongerInAdminAllowlist() throws Exception {
        String email = uniqueEmail("stale-admin");
        RegistrationTestSupport.registerAndConfirm(mockMvc, objectMapper, testCodeCache, email, "Stale");

        // Simulates a user who was previously ADMIN (e.g. removed from ADMIN_EMAILS since)
        // -- directly flip the DB row, bypassing the app layer, the way a stale row from a
        // past deploy would look.
        User user = userRepository.findByEmail(email).orElseThrow();
        user.setRole("ADMIN");
        userRepository.save(user);

        String freshToken = login(email, "password123");

        String meResponse = mockMvc.perform(get("/api/auth/me").header("Authorization", "Bearer " + freshToken))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        assertTrue(meResponse.contains("\"role\":\"USER\""));

        mockMvc.perform(get("/api/admin/overview").header("Authorization", "Bearer " + freshToken))
                .andExpect(status().isForbidden());
    }

    @Test
    @Order(8)
    void registrationAlertSettingsRoundTripRequiresAdminAndPersists() throws Exception {
        // PUT is the one mutating admin endpoint -- unauthenticated/non-admin must be rejected
        // exactly like every GET route above, not silently permitAll'd because it's a PUT.
        String updateBody = objectMapper.writeValueAsString(Map.of(
                "alertOnRegistrationConfirmed", true,
                "alertOnSendFailure", false,
                "alertOnDeliveryFailure", true,
                "alertOnContactMessage", false));

        mockMvc.perform(put("/api/admin/registration-alert-settings")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(updateBody))
                .andExpect(status().isUnauthorized());

        String nonAdminEmail = uniqueEmail("settings-non-admin");
        String nonAdminToken = RegistrationTestSupport
                .registerAndConfirm(mockMvc, objectMapper, testCodeCache, nonAdminEmail, "NonAdmin")
                .get("token").asText();
        mockMvc.perform(put("/api/admin/registration-alert-settings")
                        .header("Authorization", "Bearer " + nonAdminToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(updateBody))
                .andExpect(status().isForbidden());

        mockMvc.perform(put("/api/admin/registration-alert-settings")
                        .header("Authorization", "Bearer " + adminToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(updateBody))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.alertOnRegistrationConfirmed").value(true))
                .andExpect(jsonPath("$.alertOnSendFailure").value(false))
                .andExpect(jsonPath("$.alertOnDeliveryFailure").value(true))
                .andExpect(jsonPath("$.alertOnContactMessage").value(false));

        mockMvc.perform(get("/api/admin/registration-alert-settings").header("Authorization", "Bearer " + adminToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.alertOnRegistrationConfirmed").value(true))
                .andExpect(jsonPath("$.alertOnSendFailure").value(false))
                .andExpect(jsonPath("$.alertOnDeliveryFailure").value(true))
                .andExpect(jsonPath("$.alertOnContactMessage").value(false));
    }

    @Test
    @Order(9)
    void registrationEventsSurfaceRegisterStartedWithoutLeakingHashesOrCodes() throws Exception {
        String email = uniqueEmail("activity-feed");
        mockMvc.perform(post("/api/auth/register")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(
                                Map.of("email", email, "password", "password123", "personName", "Feed"))))
                .andExpect(status().isOk());

        String response = mockMvc.perform(get("/api/admin/registration-events")
                        .header("Authorization", "Bearer " + adminToken))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();

        assertTrue(response.contains(email));
        assertTrue(response.contains("REGISTER_STARTED"));
        assertFalse(response.contains("passwordHash"));
        assertFalse(response.contains("codeHash"));
    }

    // The two comp routes are the portal's third sanctioned write, and the most privileged thing it
    // can do -- so they get the same 401/403/success gauntlet the alert-settings PUT gets.
    // ADMIN_ROUTES above only drives GETs, which is why these need their own block rather than a
    // new entry in that array.
    @Test
    @Order(10)
    void grantingAPlanIsRefusedForEveryoneButAnAdmin() throws Exception {
        long accountId = anyAccountId();
        String body = objectMapper.writeValueAsString(Map.of("plan", "PLUS", "note", "authorization test"));

        mockMvc.perform(post("/api/admin/accounts/" + accountId + "/comp")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isUnauthorized());
        mockMvc.perform(delete("/api/admin/accounts/" + accountId + "/comp"))
                .andExpect(status().isUnauthorized());

        String nonAdminEmail = uniqueEmail("comp-non-admin");
        String nonAdminToken = RegistrationTestSupport
                .registerAndConfirm(mockMvc, objectMapper, testCodeCache, nonAdminEmail, "NonAdmin")
                .get("token").asText();

        // The whole point of this test: an ordinary authenticated user -- including one who owns a
        // household of their own -- must not be able to hand anybody a paid plan.
        mockMvc.perform(post("/api/admin/accounts/" + accountId + "/comp")
                        .header("Authorization", "Bearer " + nonAdminToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isForbidden());
        mockMvc.perform(delete("/api/admin/accounts/" + accountId + "/comp")
                        .header("Authorization", "Bearer " + nonAdminToken))
                .andExpect(status().isForbidden());

        // Least of all their OWN household, which is the version of this attack somebody would
        // actually try. Asserting no audit row proves the refusal happened before any write.
        long theirAccountId = accountIdForOwner(nonAdminEmail);
        mockMvc.perform(post("/api/admin/accounts/" + theirAccountId + "/comp")
                        .header("Authorization", "Bearer " + nonAdminToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isForbidden());
        assertTrue(billingEventRepository.findByAccountIdOrderByCreatedAtDesc(theirAccountId).isEmpty());

        mockMvc.perform(post("/api/admin/accounts/" + accountId + "/comp")
                        .header("Authorization", "Bearer " + adminToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isNoContent());
    }

    @Test
    @Order(11)
    void theAuditTrailNamesTheAuthenticatedAdminAndIgnoresASelfReportedOne() throws Exception {
        long accountId = anyAccountId();

        // A caller trying to write somebody else's name into the audit trail. AdminCompRequest has
        // no such field and Spring Boot's Jackson ignores unknown properties, so this is accepted as
        // an ordinary grant -- and must still be recorded against the TOKEN's identity. If an
        // actorEmail field were ever added to that record, this test is what should start failing.
        String spoofed = objectMapper.writeValueAsString(Map.of(
                "plan", "PLUS",
                "note", "audit test",
                "actorEmail", "someone-else@example.com"));

        mockMvc.perform(post("/api/admin/accounts/" + accountId + "/comp")
                        .header("Authorization", "Bearer " + adminToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(spoofed))
                .andExpect(status().isNoContent());

        List<BillingEvent> audit = billingEventRepository.findByAccountIdOrderByCreatedAtDesc(accountId);
        BillingEvent granted = audit.stream()
                .filter(e -> e.getEventType() == BillingEventType.COMP_GRANTED)
                .findFirst().orElseThrow();
        assertTrue(granted.getDetail().contains(ADMIN_EMAIL));
        assertFalse(granted.getDetail().contains("someone-else@example.com"));

        // Free is not a grant -- removing one is DELETE, and it has its own audit event.
        mockMvc.perform(post("/api/admin/accounts/" + accountId + "/comp")
                        .header("Authorization", "Bearer " + adminToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of("plan", "FREE"))))
                .andExpect(status().isBadRequest());

        // A tier this build does not know is refused, never guessed at.
        mockMvc.perform(post("/api/admin/accounts/" + accountId + "/comp")
                        .header("Authorization", "Bearer " + adminToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of("plan", "ENTERPRISE"))))
                .andExpect(status().isBadRequest());

        mockMvc.perform(delete("/api/admin/accounts/" + accountId + "/comp")
                        .header("Authorization", "Bearer " + adminToken))
                .andExpect(status().isNoContent());
        assertTrue(billingEventRepository.findByAccountIdOrderByCreatedAtDesc(accountId).stream()
                .anyMatch(e -> e.getEventType() == BillingEventType.COMP_REVOKED));
    }

    private long anyAccountId() throws Exception {
        return objectMapper.readTree(adminAccountsJson()).get(0).get("id").asLong();
    }

    private long accountIdForOwner(String email) throws Exception {
        for (var row : objectMapper.readTree(adminAccountsJson())) {
            if (email.equals(row.get("userEmail").asText())) {
                return row.get("id").asLong();
            }
        }
        throw new AssertionError("no household found for " + email);
    }

    private String adminAccountsJson() throws Exception {
        return mockMvc.perform(get("/api/admin/accounts").header("Authorization", "Bearer " + adminToken))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
    }
}
