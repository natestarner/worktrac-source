package com.worktrac.backend.billing;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;

// Persists one row per billing lifecycle event, independent of whatever transaction the caller is
// in. Mirrors RegistrationAuditService, including the reason REQUIRES_NEW is load-bearing rather
// than incidental: several failure branches record-then-throw, and without its own transaction the
// row recording the failure would roll back along with everything else -- making failures the one
// thing this table never captured.
//
// Every method here is annotated, not just the widest one. Spring's transactional advice is applied
// by a proxy around the bean, which only intercepts calls arriving from OUTSIDE the class, so a
// shorthand overload delegating via a plain self-call would silently run inside the caller's
// transaction. RegistrationAuditService documents the same trap, found there by a real test failure.
@Service
public class BillingAuditService {

    private static final Logger log = LoggerFactory.getLogger(BillingAuditService.class);

    private static final int MAX_DETAIL_LENGTH = 1000;

    private final BillingEventRepository repository;
    private final Clock clock;

    public BillingAuditService(BillingEventRepository repository, Clock clock) {
        this.repository = repository;
        this.clock = clock;
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void record(Long accountId, String stripeEventId, BillingEventType eventType, String detail) {
        repository.save(new BillingEvent(accountId, stripeEventId, eventType, truncate(detail),
                clock.instant()));
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void record(Long accountId, BillingEventType eventType, String detail) {
        record(accountId, null, eventType, detail);
    }

    // Returns false when this Stripe event has already been recorded, which is how webhook
    // idempotency is enforced: V57's filtered unique index on stripe_event_id is the dedup point,
    // and the constraint violation IS the "already seen" signal. There is deliberately no
    // "have I seen this?" SELECT beforehand -- a check-then-insert has a race the index does not,
    // and two mechanisms for one job is the bug this codebase keeps paying for elsewhere.
    //
    // Stripe redelivers events on its own retry schedule and on demand from the Dashboard, so this
    // is an ordinary, expected outcome rather than an error worth alerting on.
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public boolean recordIfFirstSeen(Long accountId, String stripeEventId, BillingEventType eventType,
                                      String detail) {
        try {
            repository.saveAndFlush(new BillingEvent(accountId, stripeEventId, eventType,
                    truncate(detail), clock.instant()));
            return true;
        } catch (DataIntegrityViolationException alreadyRecorded) {
            log.info("Ignoring redelivered Stripe event {}", stripeEventId);
            return false;
        }
    }

    private String truncate(String detail) {
        if (detail == null) return null;
        return detail.length() > MAX_DETAIL_LENGTH ? detail.substring(0, MAX_DETAIL_LENGTH) : detail;
    }
}
