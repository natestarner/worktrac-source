package com.worktrac.backend.admin;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.worktrac.backend.email.EmailService;
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

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

// Covers the whole admin RBAC surface in one Spring context/container (rather than one
// per concern) to keep CI runtime down -- see the "Test suite parallelization" pattern
// already established across this test suite. Methods are ordered because @Order(1)
// establishes the one admin identity every later test reuses (ADMIN_EMAIL can only be
// registered/confirmed once per running container, so it can't be repeated per method
// the way uniqueEmail() lets ordinary users be).
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("local")
@Testcontainers
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
@TestPropertySource(properties = "app.admin.emails=" + AdminAuthorizationTest.ADMIN_EMAIL)
class AdminAuthorizationTest {

    static final String ADMIN_EMAIL = "admin-portal-test@example.com";

    private static final String[] ADMIN_ROUTES = {
            "/api/admin/overview", "/api/admin/accounts", "/api/admin/people",
            "/api/admin/pending-registrations", "/api/admin/health"
    };

    @Container
    @ServiceConnection
    static MSSQLServerContainer<?> sqlServer = new MSSQLServerContainer<>("mcr.microsoft.com/mssql/server:2022-latest")
            .acceptLicense();

    // Real EmailService constructor builds a live Azure EmailClient -- mocked out so
    // registering test users never depends on a real ACS resource.
    @MockitoBean
    private EmailService emailService;

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
}
