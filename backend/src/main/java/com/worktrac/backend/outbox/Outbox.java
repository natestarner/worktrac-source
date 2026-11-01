package com.worktrac.backend.outbox;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.MDC;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

// Puts work in the outbox (V87__create_outbox.sql) -- an email, or another external side effect
// that must happen exactly when a database change commits and must survive the replica that made it.
//
// ⚠️ CALL IT INSIDE THE TRANSACTION THAT MAKES THE CHANGE. That is the whole point: the row then
// commits or rolls back with the change, so "the change happened but the email was lost" and "the
// email went out for a change that rolled back" both stop being possible. The listeners that
// enqueue (RegistrationEmailEventListener and friends) are therefore plain synchronous
// @EventListeners -- they run on the publisher's thread, inside its transaction -- not the
// AFTER_COMMIT + @Async pair they used to be, which held the only copy of the work in memory.
//
// After the commit, the replica that wrote the row tries it immediately (off the request thread, on
// emailTaskExecutor), so a verification code still arrives in seconds. If that replica dies first,
// or the attempt fails, OutboxDispatcher's poll on any replica picks the row up.
//
// Called outside any transaction, the insert simply autocommits and the attempt is scheduled at once.
@Component
public class Outbox {

    static final ObjectMapper JSON = new ObjectMapper()
            .configure(com.fasterxml.jackson.databind.DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);

    private final JdbcTemplate jdbc;
    private final OutboxPayloadCipher cipher;
    private final OutboxDispatcher dispatcher;

    public Outbox(JdbcTemplate jdbc, OutboxPayloadCipher cipher, OutboxDispatcher dispatcher) {
        this.jdbc = jdbc;
        this.cipher = cipher;
        this.dispatcher = dispatcher;
    }

    /**
     * Records {@code payload} for the handler named {@code handler}, in the caller's transaction.
     *
     * @return the row's id
     */
    public long enqueue(String handler, Object payload) {
        String json;
        try {
            json = JSON.writeValueAsString(payload);
        } catch (JsonProcessingException e) {
            // A payload that cannot be serialized is a programming error, and failing the caller's
            // transaction is the honest outcome: committing the change without its email is the
            // exact silent loss this class exists to prevent.
            throw new IllegalStateException("Outbox payload for " + handler + " is not serializable", e);
        }
        Long id = jdbc.queryForObject(
                "INSERT INTO outbox (handler, payload, cid) OUTPUT inserted.id VALUES (?, ?, ?)",
                Long.class, handler, cipher.encrypt(json), MDC.get("cid"));

        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override
                public void afterCommit() {
                    dispatcher.dispatchSoon(id);
                }
            });
        } else {
            dispatcher.dispatchSoon(id);
        }
        return id;
    }
}
