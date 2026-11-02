package com.worktrac.backend.outbox;

import java.util.List;

/**
 * Implemented by each component that puts work in the outbox, so its handlers live beside the code
 * that enqueues them. {@link OutboxDispatcher} collects every provider at startup and refuses to
 * start on a duplicated handler name.
 */
public interface OutboxHandlerProvider {

    List<OutboxHandler<?>> outboxHandlers();
}
