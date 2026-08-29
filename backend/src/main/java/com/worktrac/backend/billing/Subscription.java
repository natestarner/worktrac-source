package com.worktrac.backend.billing;

import com.worktrac.backend.account.Account;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.FetchType;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.time.Instant;

// One row per account (accounts is the billable entity -- one household, one login, many people,
// no seats). See V56 for the schema and why account_id is UNIQUE.
//
// This holds what STRIPE said. It deliberately carries no "is_pro" column: entitlement is derived
// from status + currentPeriodEnd + comped by SubscriptionService.isPro, which is the only place
// that question is answered. Adding a stored flag here would turn four correct cases (past-due
// grace, cancelled-but-paid-through, clock-based expiry needing no webhook, comped) into four
// things to keep in sync.
@Entity
@Table(name = "subscriptions")
public class Subscription {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "account_id", nullable = false)
    private Account account;

    @Column(name = "stripe_customer_id", length = 255)
    private String stripeCustomerId;

    @Column(name = "stripe_subscription_id", length = 255)
    private String stripeSubscriptionId;

    @Column(name = "stripe_price_id", length = 255)
    private String stripePriceId;

    @Enumerated(EnumType.STRING)
    @Column(name = "billing_plan", nullable = false, length = 20)
    private BillingPlan plan = BillingPlan.FREE;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 30)
    private SubscriptionStatus status = SubscriptionStatus.FREE;

    @Enumerated(EnumType.STRING)
    @Column(name = "billing_interval", length = 10)
    private BillingInterval billingInterval;

    @JdbcTypeCode(SqlTypes.TIMESTAMP)
    @Column(name = "current_period_end")
    private Instant currentPeriodEnd;

    @Column(name = "cancel_at_period_end", nullable = false)
    private boolean cancelAtPeriodEnd;

    // Grants Pro with no Stripe object behind it -- how founding households are kept whole when the
    // Free-tier window lands, without coupon codes, a card prompt, or an admin write action.
    @Column(nullable = false)
    private boolean comped;

    @JdbcTypeCode(SqlTypes.TIMESTAMP)
    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @JdbcTypeCode(SqlTypes.TIMESTAMP)
    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    protected Subscription() {
    }

    // Timestamps are passed in rather than set from Instant.now() in a @PrePersist, unlike the
    // older entities here: every write to this table happens in a service that already holds the
    // injected Clock, and billing state is exactly the kind of time-dependent logic that has to be
    // driveable by MutableClock in tests. See .claude/rules/backend-core.md.
    public Subscription(Account account, Instant now) {
        this.account = account;
        this.createdAt = now;
        this.updatedAt = now;
    }

    public Long getId() {
        return id;
    }

    public Account getAccount() {
        return account;
    }

    public String getStripeCustomerId() {
        return stripeCustomerId;
    }

    public void setStripeCustomerId(String stripeCustomerId) {
        this.stripeCustomerId = stripeCustomerId;
    }

    public String getStripeSubscriptionId() {
        return stripeSubscriptionId;
    }

    public void setStripeSubscriptionId(String stripeSubscriptionId) {
        this.stripeSubscriptionId = stripeSubscriptionId;
    }

    public String getStripePriceId() {
        return stripePriceId;
    }

    public void setStripePriceId(String stripePriceId) {
        this.stripePriceId = stripePriceId;
    }

    public BillingPlan getPlan() {
        return plan;
    }

    public void setPlan(BillingPlan plan) {
        this.plan = plan;
    }

    public SubscriptionStatus getStatus() {
        return status;
    }

    public void setStatus(SubscriptionStatus status) {
        this.status = status;
    }

    public BillingInterval getBillingInterval() {
        return billingInterval;
    }

    public void setBillingInterval(BillingInterval billingInterval) {
        this.billingInterval = billingInterval;
    }

    public Instant getCurrentPeriodEnd() {
        return currentPeriodEnd;
    }

    public void setCurrentPeriodEnd(Instant currentPeriodEnd) {
        this.currentPeriodEnd = currentPeriodEnd;
    }

    public boolean isCancelAtPeriodEnd() {
        return cancelAtPeriodEnd;
    }

    public void setCancelAtPeriodEnd(boolean cancelAtPeriodEnd) {
        this.cancelAtPeriodEnd = cancelAtPeriodEnd;
    }

    public boolean isComped() {
        return comped;
    }

    public void setComped(boolean comped) {
        this.comped = comped;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public Instant getUpdatedAt() {
        return updatedAt;
    }

    public void setUpdatedAt(Instant updatedAt) {
        this.updatedAt = updatedAt;
    }
}
