package com.worktrac.backend.emaildelivery;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

// Shape of the "data" object on the one-time Microsoft.EventGrid.SubscriptionValidationEvent
// Event Grid sends when a new subscription targeting this webhook is created -- the endpoint
// must echo validationCode back (see EmailDeliveryWebhookController) before Event Grid will
// consider the subscription active and start delivering real events to it.
@JsonIgnoreProperties(ignoreUnknown = true)
public record SubscriptionValidationPayload(String validationCode) {
}
