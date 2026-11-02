package com.worktrac.backend.billing;

import org.springframework.data.repository.query.Param;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;

import java.util.List;

public interface BillingEventRepository extends JpaRepository<BillingEvent, Long> {

    List<BillingEvent> findTop200ByOrderByCreatedAtDesc();

    List<BillingEvent> findByAccountIdOrderByCreatedAtDesc(Long accountId);

    // accountId is a plain column here rather than an association (see BillingEvent's header --
    // an unattributable webhook still gets a row), so deletion is a bulk statement rather than a
    // cascade. AccountDeletionService and TestDataCleanupService both call this.
    @Modifying
    @Query("DELETE FROM BillingEvent e WHERE e.accountId IN :accountIds")
    void deleteByAccountIdIn(List<Long> accountIds);

    // BillingAuditService.forgetFirstSeen: un-claims a Stripe event whose processing failed, so
    // Stripe's retry of it is processed rather than ignored as a duplicate.
    @Modifying
    @Query("delete from BillingEvent e where e.stripeEventId = :stripeEventId")
    int deleteByStripeEventId(@Param("stripeEventId") String stripeEventId);
}
