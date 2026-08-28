package com.worktrac.backend.billing;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.time.Instant;

// One row per billing lifecycle event. See V57 for why this table exists at all: an async dispatch
// mechanism must never have a code path where "the event never arrived" and "it arrived and nothing
// went wrong" look identical from the outside.
//
// accountId is a plain Long rather than a @ManyToOne Account: a rejected or unattributable webhook
// still deserves a row, and an event we could not match to a household is exactly the thing that
// must not vanish silently.
@Entity
@Table(name = "billing_events")
public class BillingEvent {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "account_id")
    private Long accountId;

    @Column(name = "stripe_event_id", length = 255)
    private String stripeEventId;

    @Enumerated(EnumType.STRING)
    @Column(name = "event_type", nullable = false, length = 60)
    private BillingEventType eventType;

    @Column(length = 1000)
    private String detail;

    @JdbcTypeCode(SqlTypes.TIMESTAMP)
    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    protected BillingEvent() {
    }

    public BillingEvent(Long accountId, String stripeEventId, BillingEventType eventType, String detail,
                         Instant createdAt) {
        this.accountId = accountId;
        this.stripeEventId = stripeEventId;
        this.eventType = eventType;
        this.detail = detail;
        this.createdAt = createdAt;
    }

    public Long getId() {
        return id;
    }

    public Long getAccountId() {
        return accountId;
    }

    public String getStripeEventId() {
        return stripeEventId;
    }

    public BillingEventType getEventType() {
        return eventType;
    }

    public String getDetail() {
        return detail;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }
}
