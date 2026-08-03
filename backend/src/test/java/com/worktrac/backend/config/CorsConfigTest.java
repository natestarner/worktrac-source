package com.worktrac.backend.config;

import com.worktrac.backend.support.AbstractIntegrationTest;
import com.worktrac.backend.email.EmailService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;

// Regression test for the offline banner's "Go back online" bug: probeReachability()
// (frontend/src/lib/reachabilityProbe.js) fetches /actuator/health cross-origin, but that
// endpoint was missing from CorsConfig's registered patterns, so the browser withheld
// Access-Control-Allow-Origin and the fetch failed as a network error in every deployed
// environment -- even though /actuator/health itself is permitAll() and answers fine.
// Local dev never reproduced this because Vite's proxy makes the request same-origin.
@AutoConfigureMockMvc
class CorsConfigTest extends AbstractIntegrationTest {

    @DynamicPropertySource
    static void datasource(DynamicPropertyRegistry registry) {
        registerDatasource(registry, CorsConfigTest.class);
    }

    @Autowired
    private MockMvc mockMvc;

    // EmailService's real constructor builds a live Azure EmailClient from a connection string
    // that isn't set in CI -- @MockitoBean replaces the bean entirely so that constructor never
    // runs (same pattern as AccountDeletionTest).
    @MockitoBean
    private EmailService emailService;

    @Test
    void actuatorHealthAnswersCrossOriginRequestsFromAnAllowedOrigin() throws Exception {
        String origin = "http://localhost:3000"; // app.cors.allowed-origins default (application.yml)

        mockMvc.perform(get("/actuator/health").header("Origin", origin))
                .andExpect(header().string("Access-Control-Allow-Origin", origin));
    }
}
