package com.worktrac.backend.user;

import com.fasterxml.jackson.databind.JsonNode;
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

import java.util.Map;
import java.util.UUID;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

// Tokens were accepted purely on signature and expiry, so there was no way to end a session before
// its 30-day life ran out. The consequence worth fixing: resetting your password did not sign you
// out anywhere else, so someone resetting precisely BECAUSE they believed they were compromised
// stayed compromised for up to a month, on a screen implying otherwise.
@AutoConfigureMockMvc
class TokenRevocationTest extends AbstractIntegrationTest {

    @DynamicPropertySource
    static void datasource(DynamicPropertyRegistry registry) {
        registerDatasource(registry, TokenRevocationTest.class);
    }

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private TestCodeCache testCodeCache;

    @MockitoBean
    private EmailService emailService;

    private final ObjectMapper objectMapper = new ObjectMapper();

    private int meStatus(String token) throws Exception {
        return mockMvc.perform(get("/api/auth/me").header("Authorization", "Bearer " + token))
                .andReturn().getResponse().getStatus();
    }

    @Test
    void aPasswordResetInvalidatesTokensIssuedBeforeIt() throws Exception {
        String email = "revoke-" + UUID.randomUUID().toString().substring(0, 8) + "@example.com";
        JsonNode registration =
                RegistrationTestSupport.registerAndConfirm(mockMvc, objectMapper, testCodeCache, email, "Ari");
        String oldToken = registration.get("token").asText();

        // The session on the other device, working normally.
        org.junit.jupiter.api.Assertions.assertEquals(200, meStatus(oldToken));

        mockMvc.perform(post("/api/auth/forgot-password")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of("email", email))))
                .andExpect(status().isOk());
        String resetCode = testCodeCache.get(email);

        mockMvc.perform(post("/api/auth/reset-password")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of(
                                "email", email, "code", resetCode, "password", "a-brand-new-password"))))
                .andExpect(status().isOk());

        // The other device is signed out. 401 is what the client already treats as an expired
        // session, so this needs no new handling there.
        org.junit.jupiter.api.Assertions.assertEquals(401, meStatus(oldToken));
    }

    @Test
    void loggingInAfterTheResetIssuesAWorkingToken() throws Exception {
        String email = "revoke2-" + UUID.randomUUID().toString().substring(0, 8) + "@example.com";
        RegistrationTestSupport.registerAndConfirm(mockMvc, objectMapper, testCodeCache, email, "Bo");

        mockMvc.perform(post("/api/auth/forgot-password")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of("email", email))))
                .andExpect(status().isOk());
        String resetCode = testCodeCache.get(email);
        String newPassword = "a-brand-new-password";

        mockMvc.perform(post("/api/auth/reset-password")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of(
                                "email", email, "code", resetCode, "password", newPassword))))
                .andExpect(status().isOk());

        String freshToken = objectMapper.readTree(mockMvc.perform(post("/api/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of("email", email, "password", newPassword))))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString()).get("token").asText();

        // The bump must not lock the person out of their own account -- the new token carries the
        // new version.
        org.junit.jupiter.api.Assertions.assertEquals(200, meStatus(freshToken));
    }
}
