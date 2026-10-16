package com.worktrac.backend.billing;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;

import java.time.Instant;
import java.util.List;
import java.util.Optional;

public interface SubscriptionRepository extends JpaRepository<Subscription, Long> {

    Optional<Subscription> findByAccountId(Long accountId);

    // The webhook's fallback attribution route when a Stripe payload carries no metadata.accountId
    // (Portal-initiated changes do not always round-trip it). Unique by V56's filtered index.
    Optional<Subscription> findByStripeCustomerId(String stripeCustomerId);

    Optional<Subscription> findByStripeSubscriptionId(String stripeSubscriptionId);

    // The reconciliation watchdog's query: subscriptions whose paid period has lapsed but whose
    // status still claims good standing -- i.e. a subscription.deleted that never arrived.
    List<Subscription> findByStatusInAndCurrentPeriodEndLessThan(
            List<SubscriptionStatus> statuses, Instant cutoff);

    // Claims the once-ever welcome email: 1 for the caller that set the column, 0 for everyone else.
    //
    // ⚠️ ONE CONDITIONAL STATEMENT, NOT READ-THEN-SET. A real checkout lands three webhooks and the
    // browser's reconcile within the same second, each in its own transaction, and every one of them
    // reads the column as null before any commits -- the entity check alone sent the welcome three
    // times. SQL Server serializes the UPDATE on the row lock, so exactly one caller sees a null to
    // overwrite. This is the column's ONLY writer: the entity maps it updatable = false, or a losing
    // transaction's flush would write its stale null back over the winner's claim.
    // Pinned by PlusWelcomeConcurrencyTest.
    @Modifying(flushAutomatically = true)
    @Query(value = "UPDATE subscriptions SET plus_welcome_sent_at = :now WHERE id = :id AND plus_welcome_sent_at IS NULL",
            nativeQuery = true)
    int claimPlusWelcome(Long id, Instant now);

    // Bulk, not entity-at-a-time: AccountDeletionService and TestDataCleanupService both need this
    // and the latter deletes whole cohorts. The FK to accounts is NO ACTION (see V56), so these
    // rows must go before the accounts they point at.
    @Modifying
    @Query("DELETE FROM Subscription s WHERE s.account.id IN :accountIds")
    void deleteByAccountIdIn(List<Long> accountIds);
}
