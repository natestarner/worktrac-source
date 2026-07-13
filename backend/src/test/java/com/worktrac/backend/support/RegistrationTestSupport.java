package com.worktrac.backend.support;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.worktrac.backend.user.TestCodeCache;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

import java.util.Map;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

// Shared by every @SpringBootTest that needs a logged-in user: registration no longer returns
// a token directly, so getting one now means driving the real register -> confirm-email flow
// (reading the code via TestCodeCache -- the same mechanism the test-support HTTP endpoint
// reads from for Playwright e2e -- rather than over HTTP, so an unrelated test class doesn't
// depend on that endpoint's header mechanics; those get their own focused test). Centralized
// here instead of copy-pasted into each of the ten test classes that previously called
// /api/auth/register directly in their setup.
public final class RegistrationTestSupport {

    private RegistrationTestSupport() {
    }

    public static JsonNode registerAndConfirm(MockMvc mockMvc, ObjectMapper objectMapper, TestCodeCache testCodeCache,
                                               String email, String personName) throws Exception {
        String normalizedEmail = email.trim().toLowerCase();
        String registerBody = objectMapper.writeValueAsString(Map.of(
                "email", email, "password", "password123", "personName", personName));
        mockMvc.perform(post("/api/auth/register")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(registerBody))
                .andExpect(status().isOk());

        String code = testCodeCache.get(normalizedEmail);
        String confirmBody = objectMapper.writeValueAsString(Map.of("email", email, "code", code));
        String response = mockMvc.perform(post("/api/auth/confirm-email")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(confirmBody))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        return objectMapper.readTree(response);
    }
}
