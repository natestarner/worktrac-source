package com.worktrac.backend.emaildelivery;

import com.worktrac.backend.support.AbstractIntegrationTest;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.worktrac.backend.email.EmailService;
import com.worktrac.backend.registrationaudit.RegistrationEvent;
import com.worktrac.backend.registrationaudit.RegistrationEventRepository;
import com.worktrac.backend.registrationaudit.RegistrationEventType;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

// Covers the Event Grid delivery-report webhook -- the only source of TRUE email delivery
// truth (as opposed to EmailService's "ACS accepted the send" truth). This is exercised purely
// with hand-built sample payloads matching Event Grid's real schema; the live end-to-end path
// (a real Event Grid subscription actually calling this endpoint) can only be verified once
// deployed, since Event Grid is cloud-only and cannot reach a local dev machine.
@SpringBootTest(properties = "app.email-delivery-webhook.key=test-webhook-key-123")
@AutoConfigureMockMvc
class EmailDeliveryWebhookControllerTest extends AbstractIntegrationTest {

    @DynamicPropertySource
    static void datasource(DynamicPropertyRegistry registry) {
        registerDatasource(registry, EmailDeliveryWebhookControllerTest.class);
    }

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private RegistrationEventRepository registrationEventRepository;

    // Real EmailService constructor builds a live Azure EmailClient -- mocked out even though
    // this test never calls it, since app.email.connection-string is empty in the local test
    // profile and the real constructor would fail context startup.
    @MockitoBean
    private EmailService emailService;

    private final ObjectMapper objectMapper = new ObjectMapper();

    private String uniqueEmail(String label) {
        return label + "-" + UUID.randomUUID().toString().substring(0, 8) + "@example.com";
    }

    private List<RegistrationEvent> eventsFor(String email) {
        return registrationEventRepository.findAll().stream()
                .filter(e -> e.getEmail().equals(email))
                .toList();
    }

    @Test
    void missingKeyIsRejected() throws Exception {
        mockMvc.perform(post("/api/webhooks/email-delivery")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("[]"))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void wrongKeyIsRejected() throws Exception {
        mockMvc.perform(post("/api/webhooks/email-delivery")
                        .param("key", "not-the-right-key")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("[]"))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void subscriptionValidationEventEchoesValidationCode() throws Exception {
        String body = objectMapper.writeValueAsString(List.of(Map.of(
                "id", "validation-event-1",
                "eventType", "Microsoft.EventGrid.SubscriptionValidationEvent",
                "data", Map.of("validationCode", "abc-123-validate-me"))));

        mockMvc.perform(post("/api/webhooks/email-delivery")
                        .param("key", "test-webhook-key-123")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.validationResponse").value("abc-123-validate-me"));
    }

    @Test
    void bouncedDeliveryReportIsRecordedWithTheRealSmtpDiagnostic() throws Exception {
        String email = uniqueEmail("webhook-bounce");
        String body = objectMapper.writeValueAsString(List.of(Map.of(
                "id", "delivery-event-1",
                "eventType", "Microsoft.Communication.EmailDeliveryReportReceived",
                "data", Map.of(
                        "recipient", email,
                        "messageId", "acs-message-id-bounce-1",
                        "status", "Bounced",
                        "deliveryStatusDetails", Map.of("statusMessage", "550 5.1.1 mailbox does not exist")))));

        mockMvc.perform(post("/api/webhooks/email-delivery")
                        .param("key", "test-webhook-key-123")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isOk());

        List<RegistrationEvent> events = eventsFor(email);
        assertEquals(1, events.size());
        assertEquals(RegistrationEventType.EMAIL_BOUNCED, events.get(0).getEventType());
        assertEquals("acs-message-id-bounce-1", events.get(0).getMessageId());
        assertTrue(events.get(0).getDetail().contains("550 5.1.1 mailbox does not exist"));
    }

    @Test
    void deliveredReportIsRecorded() throws Exception {
        String email = uniqueEmail("webhook-delivered");
        String body = objectMapper.writeValueAsString(List.of(Map.of(
                "id", "delivery-event-2",
                "eventType", "Microsoft.Communication.EmailDeliveryReportReceived",
                "data", Map.of(
                        "recipient", email,
                        "messageId", "acs-message-id-delivered-1",
                        "status", "Delivered",
                        "deliveryStatusDetails", Map.of("statusMessage", "Delivered")))));

        mockMvc.perform(post("/api/webhooks/email-delivery")
                        .param("key", "test-webhook-key-123")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isOk());

        List<RegistrationEvent> events = eventsFor(email);
        assertEquals(1, events.size());
        assertEquals(RegistrationEventType.EMAIL_DELIVERED, events.get(0).getEventType());
    }

    @Test
    void unrecognizedStatusFallsBackToDeliveryFailedRatherThanBeingDropped() throws Exception {
        String email = uniqueEmail("webhook-unknown");
        String body = objectMapper.writeValueAsString(List.of(Map.of(
                "id", "delivery-event-3",
                "eventType", "Microsoft.Communication.EmailDeliveryReportReceived",
                "data", Map.of(
                        "recipient", email,
                        "messageId", "acs-message-id-unknown-1",
                        "status", "SomeFutureAcsStatus"))));

        mockMvc.perform(post("/api/webhooks/email-delivery")
                        .param("key", "test-webhook-key-123")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isOk());

        List<RegistrationEvent> events = eventsFor(email);
        assertEquals(1, events.size());
        assertEquals(RegistrationEventType.EMAIL_DELIVERY_FAILED, events.get(0).getEventType());
        assertEquals("SomeFutureAcsStatus", events.get(0).getDetail());
    }
}
