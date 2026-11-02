package com.worktrac.backend.support;

import com.worktrac.backend.outbox.OutboxHandler;
import com.worktrac.backend.outbox.OutboxHandlerProvider;

import java.util.List;

/**
 * Runs a provider's outbox handlers on a payload synchronously, the way {@code OutboxDispatcher}
 * does with a single attempt: deliver, and on failure give up with the same reason format. For
 * plain unit tests of a listener's send-and-record logic, with no Spring context or database.
 */
public final class OutboxTestSupport {

    private OutboxTestSupport() {
    }

    /** Delivers {@code payload} through every handler of {@code provider} that takes its type. */
    public static void deliver(OutboxHandlerProvider provider, Object payload) {
        List<OutboxHandler<?>> matching = provider.outboxHandlers().stream()
                .filter(handler -> handler.payloadType().isInstance(payload))
                .toList();
        if (matching.isEmpty()) {
            throw new IllegalArgumentException("No outbox handler takes " + payload.getClass().getSimpleName());
        }
        matching.forEach(handler -> deliverOnce(handler, payload));
    }

    private static <P> void deliverOnce(OutboxHandler<P> handler, Object payload) {
        P typed = handler.payloadType().cast(payload);
        try {
            handler.delivery().deliver(typed);
        } catch (Exception e) {
            String message = e.getMessage();
            String reason = message != null && !message.isBlank()
                    ? e.getClass().getSimpleName() + ": " + message
                    : e.getClass().getSimpleName();
            handler.giveUp().giveUp(typed, reason + " (after 1 attempt)");
        }
    }
}
