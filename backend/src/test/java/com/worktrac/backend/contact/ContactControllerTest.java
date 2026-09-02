package com.worktrac.backend.contact;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.worktrac.backend.email.EmailService;
import com.worktrac.backend.support.AbstractIntegrationTest;
import com.worktrac.backend.support.RegistrationTestSupport;
import com.worktrac.backend.user.TestCodeCache;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@AutoConfigureMockMvc
class ContactControllerTest extends AbstractIntegrationTest {

    @DynamicPropertySource
    static void datasource(DynamicPropertyRegistry registry) {
        registerDatasource(registry, ContactControllerTest.class);
    }

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private TestCodeCache testCodeCache;

    @Autowired
    private ContactMessageRepository contactMessageRepository;

    // The real constructor builds a live Azure Communication Services client, which has no
    // connection string in CI.
    @MockitoBean
    private EmailService emailService;

    private final ObjectMapper objectMapper = new ObjectMapper();

    private String token;
    private Long personId;
    private String accountEmail;

    @BeforeEach
    void registerAccount() throws Exception {
        accountEmail = "contact-" + UUID.randomUUID().toString().substring(0, 8) + "@example.com";
        JsonNode auth = RegistrationTestSupport.registerAndConfirm(
                mockMvc, objectMapper, testCodeCache, accountEmail, "Nate");
        token = auth.get("token").asText();
        personId = auth.get("person").get("id").asLong();
    }

    // Every method in this class shares one database and nothing rolls back, so the repository's
    // cross-account read sees earlier methods' rows too. Scope every count to THIS method's freshly
    // registered account or the assertions measure the suite, not the behaviour.
    private List<ContactMessage> mine() {
        return contactMessageRepository.findTop500ByOrderByCreatedAtDesc().stream()
                .filter(m -> m.getSubmitterEmail().equalsIgnoreCase(accountEmail))
                .toList();
    }

    private Map<String, Object> body(String subject, String message) {
        Map<String, Object> payload = new HashMap<>();
        payload.put("category", "BUG");
        payload.put("subject", subject);
        payload.put("message", message);
        payload.put("personId", personId);
        return payload;
    }

    private int submit(Map<String, Object> payload) throws Exception {
        return mockMvc.perform(post("/api/contact")
                        .header("Authorization", "Bearer " + token)
                        .header("User-Agent", "TestAgent/1.0")
                        .header("X-Correlation-Id", "test-correlation-id")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(payload)))
                .andReturn().getResponse().getStatus();
    }

    @Test
    void storesTheMessageWithItsDiagnostics() throws Exception {
        Map<String, Object> payload = body("Rest timer resets", "It resets whenever I switch tabs mid-set.");
        payload.put("diagnostics", Map.of(
                "appBuild", "2026-08-21 07:00",
                "screen", "/app/log",
                "wasOnline", true,
                "unsyncedWrites", 2,
                "clientError", "TypeError: undefined",
                // boot-watchdog.js's record. Kept distinct from clientError on purpose: a boot that
                // never rendered produces no clientError at all, so one cannot stand in for the
                // other. See V60__add_boot_failure_to_contact_messages.sql.
                "bootFailure", "boot-failure on /app/log after 7000ms -- never painted"));

        assertEquals(202, submit(payload));

        List<ContactMessage> stored = mine();
        assertEquals(1, stored.size());
        ContactMessage message = stored.get(0);
        assertEquals(ContactCategory.BUG, message.getCategory());
        assertEquals("Rest timer resets", message.getSubject());
        assertEquals("/app/log", message.getScreen());
        assertEquals(2, message.getUnsyncedWrites());
        assertTrue(message.getWasOnline());
        assertEquals("TypeError: undefined", message.getClientError());
        assertEquals("boot-failure on /app/log after 7000ms -- never painted", message.getBootFailure());
        // Read server-side from the request, never from the body -- so the stored value is
        // guaranteed to be the one the backend logged against.
        assertEquals("TestAgent/1.0", message.getUserAgent());
        assertEquals("test-correlation-id", message.getCorrelationId());
        // The submitter identity comes from the JWT. The form has no email field at all.
        assertNotNull(message.getSubmitterEmail());
        // Deliberately NOT asserting alertStatus here: the alert listener runs on a real async
        // executor, so by this point it may or may not have reported back -- an assertion either
        // way is a race (observed returning both SENT and PENDING across runs). The status
        // transitions get their own deterministic coverage in ContactAlertStatusTest. What matters
        // here is that the message itself is stored regardless of what the email does.
        assertNotNull(message.getAlertStatus());
    }

    @Test
    void acceptsASubmissionWithNoDiagnosticsAtAll() throws Exception {
        Map<String, Object> payload = body("No diagnostics", "This client sent nothing extra at all.");
        assertEquals(202, submit(payload));

        ContactMessage message = mine().get(0);
        assertNull(message.getScreen());
        assertNull(message.getClientError());
    }

    @Test
    void rejectsAnUnauthenticatedSubmission() throws Exception {
        mockMvc.perform(post("/api/contact")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(body("Subject", "A long enough message."))))
                .andExpect(status().isUnauthorized());

        assertTrue(mine().isEmpty());
    }

    // Strict validation is safe here ONLY because this is a Tier-3 gated write with no durable
    // outbox behind it -- see ContactRequest and backend-core.md.
    @Test
    void rejectsABlankSubject() throws Exception {
        assertEquals(400, submit(body("   ", "A long enough message body here.")));
    }

    @Test
    void rejectsATooShortMessage() throws Exception {
        assertEquals(400, submit(body("Subject", "short")));
    }

    @Test
    void rejectsAnOversizedMessage() throws Exception {
        assertEquals(400, submit(body("Subject", "x".repeat(4001))));
    }

    @Test
    void rejectsAnUnknownCategory() throws Exception {
        Map<String, Object> payload = body("Subject", "A long enough message body here.");
        payload.put("category", "COMPLAINT");
        assertEquals(400, submit(payload));
    }

    @Test
    void rejectsAMissingCategory() throws Exception {
        Map<String, Object> payload = body("Subject", "A long enough message body here.");
        payload.remove("category");
        assertEquals(400, submit(payload));
    }

    // The account-scoping guard. 404 rather than 403, so a caller can never distinguish
    // "doesn't exist" from "not yours".
    @Test
    void rejectsAPersonIdBelongingToAnotherAccount() throws Exception {
        String otherEmail = "other-" + UUID.randomUUID().toString().substring(0, 8) + "@example.com";
        JsonNode other = RegistrationTestSupport.registerAndConfirm(
                mockMvc, objectMapper, testCodeCache, otherEmail, "Someone Else");
        Long otherPersonId = other.get("person").get("id").asLong();

        Map<String, Object> payload = body("Subject", "A long enough message body here.");
        payload.put("personId", otherPersonId);

        assertEquals(404, submit(payload));
        assertTrue(mine().isEmpty());
    }

    // A double-tap or a retry after a flaky response must not read as an error, and must not
    // multiply the alert-email volume.
    @Test
    void suppressesAnIdenticalResubmitWithinTheWindow() throws Exception {
        Map<String, Object> payload = body("Same subject", "Exactly the same message body.");

        assertEquals(202, submit(payload));
        assertEquals(202, submit(payload));

        assertEquals(1, mine().size());
    }

    @Test
    void doesNotSuppressAGenuinelyDifferentMessage() throws Exception {
        assertEquals(202, submit(body("First subject", "The first message body.")));
        assertEquals(202, submit(body("Second subject", "The second message body.")));

        assertEquals(2, mine().size());
    }
}
