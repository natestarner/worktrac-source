package com.worktrac.backend.emaildelivery;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

// Shape of the "data" object on a Microsoft.Communication.EmailDeliveryReportReceived Event
// Grid event. ignoreUnknown -- ACS's payload carries several other fields (sender,
// internetMessageId, deliveryAttemptTimestamp, ...) this app has no use for; only fail parsing
// on a genuinely missing field we depend on, not an added one.
@JsonIgnoreProperties(ignoreUnknown = true)
public record EmailDeliveryReportPayload(
        String recipient,
        String messageId,
        String status,
        DeliveryStatusDetails deliveryStatusDetails) {

    // statusMessage is the real SMTP/recipient-server diagnostic (e.g. "550 5.1.1 mailbox does
    // not exist" for a bounce) -- the actual "why" behind a delivery failure, not just the
    // coarse status enum.
    @JsonIgnoreProperties(ignoreUnknown = true)
    public record DeliveryStatusDetails(String statusMessage) {
    }
}
