package com.worktrac.backend.config;

import com.worktrac.backend.email.EmailService;
import com.worktrac.backend.support.AbstractIntegrationTest;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.health.actuate.endpoint.HealthEndpointGroups;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

// The Container Apps probes read /actuator/health/liveness and /actuator/health/readiness. What each
// group contains is the whole design: neither may depend on the shared database, or one DB blip
// restarts (liveness) or de-routes (readiness) every replica at once.
@AutoConfigureMockMvc
class HealthProbesTest extends AbstractIntegrationTest {

    @DynamicPropertySource
    static void datasource(DynamicPropertyRegistry registry) {
        registerDatasource(registry, HealthProbesTest.class);
    }

    @MockitoBean
    private EmailService emailService;

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private HealthEndpointGroups groups;

    @Test
    void bothProbePathsAnswerUnauthenticated() throws Exception {
        mockMvc.perform(get("/actuator/health/liveness"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("UP"));
        mockMvc.perform(get("/actuator/health/readiness"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("UP"));
    }

    @Test
    void neitherProbeDependsOnTheDatabase() {
        assertThat(groups.get("liveness").isMember("db")).isFalse();
        assertThat(groups.get("readiness").isMember("db")).isFalse();
    }

    @Test
    void readinessWaitsForTheAuthWarmup() {
        assertThat(groups.get("readiness").isMember("readinessState")).isTrue();
        assertThat(groups.get("readiness").isMember("authWarmup")).isTrue();
        assertThat(groups.get("liveness").isMember("authWarmup")).isFalse();
    }

    // The frontend's reachability probe and the deploy workflows read the plain endpoint. It keeps
    // every contributor, the database included, and still shows no details.
    @Test
    void thePlainHealthEndpointIsUnchanged() throws Exception {
        assertThat(groups.getPrimary().isMember("db")).isTrue();
        mockMvc.perform(get("/actuator/health"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("UP"))
                .andExpect(jsonPath("$.components").doesNotExist());
    }
}
