package com.worktrac.backend.user;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.testcontainers.containers.MSSQLServerContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import java.util.Map;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

// "local" is activated so app.jwt.secret resolves to the dev-only secret in
// application-local.yml -- without an active profile, ${APP_JWT_SECRET} is left as an
// unresolved literal (too short for JWT signing) since no such env var is set in CI/dev.
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("local")
@Testcontainers
class AuthControllerTest {

    @Container
    @ServiceConnection
    static MSSQLServerContainer<?> sqlServer = new MSSQLServerContainer<>("mcr.microsoft.com/mssql/server:2022-latest")
            .acceptLicense();

    @Autowired
    private MockMvc mockMvc;

    // Constructed directly rather than @Autowired: only used for test JSON
    // convenience, and Boot's autoconfigured ObjectMapper bean type is ambiguous now
    // that both Jackson 2.x (pulled in transitively by jjwt-jackson) and Jackson 3.x
    // are on the classpath.
    private final ObjectMapper objectMapper = new ObjectMapper();

    private String registerBody(String email, String personName) throws Exception {
        return objectMapper.writeValueAsString(Map.of(
                "email", email,
                "password", "password123",
                "personName", personName));
    }

    @Test
    void registerCreatesAccountAndReturnsToken() throws Exception {
        mockMvc.perform(post("/api/auth/register")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(registerBody("alex@example.com", "Alex")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.token").isNotEmpty())
                .andExpect(jsonPath("$.user.email").value("alex@example.com"))
                .andExpect(jsonPath("$.person.name").value("Alex"))
                .andExpect(jsonPath("$.person.isPrimary").value(true))
                .andExpect(jsonPath("$.account.defaultUnit").value("lb"));
    }

    @Test
    void duplicateEmailOnRegisterReturns409() throws Exception {
        mockMvc.perform(post("/api/auth/register")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(registerBody("dupe@example.com", "Sam")))
                .andExpect(status().isOk());

        mockMvc.perform(post("/api/auth/register")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(registerBody("dupe@example.com", "Sam Again")))
                .andExpect(status().isConflict());
    }

    @Test
    void loginWithWrongPasswordReturns401() throws Exception {
        mockMvc.perform(post("/api/auth/register")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(registerBody("wrongpass@example.com", "Jordan")))
                .andExpect(status().isOk());

        String badLogin = objectMapper.writeValueAsString(Map.of(
                "email", "wrongpass@example.com",
                "password", "not-the-password"));

        mockMvc.perform(post("/api/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(badLogin))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void meWithoutTokenReturns401() throws Exception {
        mockMvc.perform(get("/api/auth/me")).andExpect(status().isUnauthorized());
    }

    @Test
    void meWithValidTokenReturnsAccountAndPeople() throws Exception {
        String response = mockMvc.perform(post("/api/auth/register")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(registerBody("me@example.com", "Taylor")))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();

        String token = objectMapper.readTree(response).get("token").asText();

        mockMvc.perform(get("/api/auth/me").header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.user.email").value("me@example.com"))
                .andExpect(jsonPath("$.people[0].name").value("Taylor"));
    }

    @Test
    void meWithGarbageTokenReturns401() throws Exception {
        mockMvc.perform(get("/api/auth/me").header("Authorization", "Bearer not-a-real-token"))
                .andExpect(status().isUnauthorized());
    }
}
