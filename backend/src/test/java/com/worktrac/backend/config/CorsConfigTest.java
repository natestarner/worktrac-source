package com.worktrac.backend.config;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.testcontainers.containers.MSSQLServerContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;

// Regression test for the offline banner's "Go back online" bug: probeReachability()
// (frontend/src/lib/reachabilityProbe.js) fetches /actuator/health cross-origin, but that
// endpoint was missing from CorsConfig's registered patterns, so the browser withheld
// Access-Control-Allow-Origin and the fetch failed as a network error in every deployed
// environment -- even though /actuator/health itself is permitAll() and answers fine.
// Local dev never reproduced this because Vite's proxy makes the request same-origin.
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("local")
@Testcontainers
class CorsConfigTest {

    @Container
    @ServiceConnection
    static MSSQLServerContainer<?> sqlServer = new MSSQLServerContainer<>("mcr.microsoft.com/mssql/server:2022-latest")
            .acceptLicense();

    @Autowired
    private MockMvc mockMvc;

    @Test
    void actuatorHealthAnswersCrossOriginRequestsFromAnAllowedOrigin() throws Exception {
        String origin = "http://localhost:3000"; // app.cors.allowed-origins default (application.yml)

        mockMvc.perform(get("/actuator/health").header("Origin", origin))
                .andExpect(header().string("Access-Control-Allow-Origin", origin));
    }
}
