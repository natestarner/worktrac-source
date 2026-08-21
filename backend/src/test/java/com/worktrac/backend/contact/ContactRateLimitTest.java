package com.worktrac.backend.contact;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.worktrac.backend.email.EmailService;
import com.worktrac.backend.support.AbstractIntegrationTest;
import com.worktrac.backend.support.RegistrationTestSupport;
import com.worktrac.backend.user.TestCodeCache;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

// Isolated Spring context with its own low limits, the same pattern AuthControllerRateLimitTest
// uses and application-local.yml documents: the shared suite runs with the limits raised to a
// ceiling no test can reach, so a class that wants to actually observe a 429 has to bring its own.
//
// Per-user is set to 2 and the other two buckets left high, so this drives exactly one bucket to
// rejection without the others confusing which limit tripped.
@SpringBootTest(properties = {
        "app.rate-limit.contact-per-user-per-hour=2",
        "app.rate-limit.contact-per-ip-per-hour=100000",
        "app.rate-limit.contact-global-per-hour=100000"
})
@AutoConfigureMockMvc
class ContactRateLimitTest extends AbstractIntegrationTest {

    @DynamicPropertySource
    static void datasource(DynamicPropertyRegistry registry) {
        registerDatasource(registry, ContactRateLimitTest.class);
    }

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private TestCodeCache testCodeCache;

    @MockitoBean
    private EmailService emailService;

    private final ObjectMapper objectMapper = new ObjectMapper();

    private String registerToken(String label) throws Exception {
        String email = label + "-" + UUID.randomUUID().toString().substring(0, 8) + "@example.com";
        JsonNode auth = RegistrationTestSupport.registerAndConfirm(mockMvc, objectMapper, testCodeCache, email, "Nate");
        return auth.get("token").asText();
    }

    // Each call sends DIFFERENT text: an identical resubmit is suppressed as a duplicate (and
    // returns 202 without consuming anything downstream), which would mask the limit entirely.
    private int submit(String token, int n) throws Exception {
        Map<String, Object> payload = new HashMap<>();
        payload.put("category", "OTHER");
        payload.put("subject", "Subject " + n);
        payload.put("message", "A distinct message body number " + n + ".");
        return mockMvc.perform(post("/api/contact")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(payload)))
                .andReturn().getResponse().getStatus();
    }

    @Test
    void rejectsWithA429OnceTheUserExceedsTheirHourlyAllowance() throws Exception {
        String token = registerToken("ratelimit");

        assertEquals(202, submit(token, 1));
        assertEquals(202, submit(token, 2));
        // 429, not 400 -- the frontend's shouldRetryWrite treats 429 as transient, so this is the
        // one 4xx that must not read as "this can never succeed".
        assertEquals(429, submit(token, 3));
    }

    // The per-user bucket is the point of limiting an AUTHENTICATED endpoint this way: one person
    // burning their allowance must not lock the rest of the household out.
    @Test
    void oneUserExhaustingTheirBucketDoesNotBlockAnother() throws Exception {
        String noisy = registerToken("noisy");
        String quiet = registerToken("quiet");

        assertEquals(202, submit(noisy, 1));
        assertEquals(202, submit(noisy, 2));
        assertEquals(429, submit(noisy, 3));

        assertEquals(202, submit(quiet, 1));
    }
}
