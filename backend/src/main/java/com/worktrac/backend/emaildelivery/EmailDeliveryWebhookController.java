package com.worktrac.backend.emaildelivery;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.worktrac.backend.config.EmailDeliveryWebhookProperties;
import com.worktrac.backend.registrationaudit.RegistrationAuditService;
import com.worktrac.backend.registrationaudit.RegistrationEventType;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

// Ingests Azure Event Grid's push delivery of Azure Communication Services email events --
// specifically Microsoft.Communication.EmailDeliveryReportReceived, the ONLY source of true
// end-to-end email delivery truth (Delivered / Bounced / FilteredSpam / Suppressed /
// Quarantined / Failed). EmailService.send's synchronous ACS result only proves the send was
// *accepted*; this webhook is what later proves whether it actually reached the recipient.
// permitAll (see SecurityConfig) -- Event Grid is a server-to-server caller with no JWT --
// gated instead by the `key` query-param shared secret (EmailDeliveryWebhookProperties, wired
// per-environment). Always appends RegistrationEvent audit rows; never mutates app data.
@RestController
@RequestMapping("/api/webhooks/email-delivery")
public class EmailDeliveryWebhookController {

    private static final Logger log = LoggerFactory.getLogger(EmailDeliveryWebhookController.class);

    private static final String VALIDATION_EVENT_TYPE = "Microsoft.EventGrid.SubscriptionValidationEvent";
    private static final String DELIVERY_REPORT_EVENT_TYPE = "Microsoft.Communication.EmailDeliveryReportReceived";

    private final EmailDeliveryWebhookProperties properties;
    private final RegistrationAuditService auditService;
    // Deliberately not @RequestBody-bound to a typed record containing a JsonNode field --
    // Spring MVC's message converter (AbstractJacksonHttpMessageConverter) fails to bind a
    // JsonNode-typed field with "Type definition error: [simple type, class
    // com.fasterxml.jackson.databind.JsonNode]" (confirmed by a real 500 in
    // EmailDeliveryWebhookControllerTest without this). Reading the raw body as a String and
    // parsing it with our own ObjectMapper -- the same pattern AuthRequestLoggingFilter already
    // uses -- sidesteps that entirely.
    private final ObjectMapper objectMapper = new ObjectMapper();

    public EmailDeliveryWebhookController(EmailDeliveryWebhookProperties properties,
                                           RegistrationAuditService auditService) {
        this.properties = properties;
        this.auditService = auditService;
    }

    // key defaults to "" (rather than the ordinary required-param behavior) so a call with no
    // key at all fails the same explicit 401 comparison below as a wrong one, instead of
    // escaping as a framework-level MissingServletRequestParameterException that GlobalExceptionHandler
    // would otherwise answer with a generic 500.
    @PostMapping
    public ResponseEntity<?> receive(@RequestParam(value = "key", required = false, defaultValue = "") String key,
                                      @RequestBody String rawBody) throws Exception {
        String expectedKey = properties.getKey();
        if (expectedKey == null || expectedKey.isBlank() || !expectedKey.equals(key)) {
            log.warn("Rejected email-delivery webhook call: missing or invalid key");
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build();
        }

        JsonNode events = objectMapper.readTree(rawBody);
        for (JsonNode event : events) {
            String eventType = event.path("eventType").asText(null);
            JsonNode data = event.path("data");

            // Event Grid sends exactly one validation event, alone, when a subscription is
            // first created -- it must get this exact response shape before Event Grid will
            // start delivering real events to this endpoint.
            if (VALIDATION_EVENT_TYPE.equals(eventType)) {
                SubscriptionValidationPayload payload =
                        objectMapper.treeToValue(data, SubscriptionValidationPayload.class);
                return ResponseEntity.ok(Map.of("validationResponse", payload.validationCode()));
            }
            if (DELIVERY_REPORT_EVENT_TYPE.equals(eventType)) {
                recordDeliveryReport(objectMapper.treeToValue(data, EmailDeliveryReportPayload.class));
            }
        }
        return ResponseEntity.ok().build();
    }

    private void recordDeliveryReport(EmailDeliveryReportPayload payload) {
        RegistrationEventType eventType = mapStatus(payload.status());
        String statusMessage = payload.deliveryStatusDetails() != null
                ? payload.deliveryStatusDetails().statusMessage()
                : null;
        String detail = statusMessage != null && !statusMessage.isBlank() ? statusMessage : payload.status();
        auditService.record(payload.recipient(), eventType, detail, null, payload.messageId());
    }

    private RegistrationEventType mapStatus(String status) {
        if (status == null) {
            return RegistrationEventType.EMAIL_DELIVERY_FAILED;
        }
        return switch (status) {
            case "Delivered" -> RegistrationEventType.EMAIL_DELIVERED;
            case "Bounced" -> RegistrationEventType.EMAIL_BOUNCED;
            case "Quarantined" -> RegistrationEventType.EMAIL_QUARANTINED;
            case "FilteredSpam" -> RegistrationEventType.EMAIL_FILTERED_SPAM;
            case "Suppressed" -> RegistrationEventType.EMAIL_SUPPRESSED;
            default -> RegistrationEventType.EMAIL_DELIVERY_FAILED;
        };
    }
}
