package com.worktrac.backend.billing;

import com.worktrac.backend.account.Account;
import com.worktrac.backend.account.AccountRepository;
import com.worktrac.backend.common.ConflictException;
import com.worktrac.backend.common.NotFoundException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Grants and removes comps -- a paid tier held with no Stripe object behind it.
 *
 * <p><b>This is the only class in production that writes {@code comped} / {@code comped_plan}.</b>
 * It replaced {@code CompBootstrap}, which applied the {@code COMPED_EMAILS} environment variable
 * at container start and therefore made handing somebody a free plan a deploy. Every household
 * comped by that mechanism keeps its grant untouched -- a comp was always a database row, never a
 * computed value, so retiring the reader changed nothing for them.
 *
 * <p>{@code TestSupportController} writes the same two columns, but is {@code @Profile}-gated to
 * local/lower and does not exist as a bean in production, so the production writer count is still
 * one. {@code SubscriptionService.applyStripeState} never touches either column, which is exactly
 * what lets a comp outlive a webhook about a lapsed card.
 *
 * <h2>Why it is safe to expose this from the admin portal</h2>
 *
 * The ability to hand out paid plans is the most privileged thing the portal does, and nothing in
 * this class is what protects it. The gate is the same one every other admin route has, and it is
 * worth stating in one place because a reader will reasonably ask:
 *
 * <ol>
 *   <li>{@code SecurityConfig} maps {@code /api/admin/**} to {@code hasRole("ADMIN")} at the filter
 *       chain. There is no per-method opt-out and no {@code permitAll} pattern overlapping it.</li>
 *   <li>The ADMIN authority is not simply read off the JWT. {@code JwtAuthenticationFilter}
 *       re-checks the token's email against {@code ADMIN_EMAILS} on <b>every request</b> and can
 *       only ever DEMOTE -- so removing somebody from the allowlist takes effect on their next
 *       request rather than at their next login, up to thirty days later.</li>
 *   <li>Reaching the filter at all already required a signed, unexpired token with no {@code scp}
 *       claim, whose {@code tv} matches the live user row and whose membership still exists
 *       ({@code TokenAuthenticator}). A password change invalidates it.</li>
 *   <li>The acting admin's identity is taken from the authenticated principal by the controller and
 *       passed in here as {@code actorEmail}. <b>It is never read from the request body</b> -- a
 *       self-reported actor is not an audit trail.</li>
 *   <li>Every grant and every revoke writes a {@code billing_events} row naming that actor. The
 *       audit trail is what makes the capability accountable rather than merely gated.</li>
 * </ol>
 *
 * <p>The request carries no account id in its body either: the account is a path variable on an
 * admin route that reads across every tenant on purpose, which is the one sanctioned exception to
 * {@code CurrentUser.accountId()} scoping ({@code .claude/rules/backend-core.md}).
 */
@Service
public class CompGrantService {

    private static final Logger log = LoggerFactory.getLogger(CompGrantService.class);

    /** Matches {@code subscriptions.comp_note}'s NVARCHAR(200) -- see V80. */
    static final int MAX_NOTE_LENGTH = 200;

    private final AccountRepository accountRepository;
    private final SubscriptionRepository subscriptionRepository;
    private final SubscriptionService subscriptionService;
    private final BillingAuditService auditService;
    private final ApplicationEventPublisher events;

    public CompGrantService(AccountRepository accountRepository,
                             SubscriptionRepository subscriptionRepository,
                             SubscriptionService subscriptionService,
                             BillingAuditService auditService,
                             ApplicationEventPublisher events) {
        this.accountRepository = accountRepository;
        this.subscriptionRepository = subscriptionRepository;
        this.subscriptionService = subscriptionService;
        this.auditService = auditService;
        this.events = events;
    }

    /**
     * Give this household {@code plan}, free, until an admin removes it.
     *
     * <p>Idempotent in effect: granting over an existing comp rewrites it, which is how a tier or a
     * band is changed.
     *
     * @param actorEmail the authenticated admin's address, for the audit row. Never client-supplied.
     */
    @Transactional
    public void grant(Long accountId, BillingPlan plan, ClientBand band, String note, String actorEmail) {
        // Body validation first: it is free, and it needs no database round trip to refuse.
        if (plan == null) {
            throw new IllegalArgumentException("Choose a plan to grant.");
        }
        // FREE is not a grant. Silently treating it as one would make the revoke path reachable by
        // two different requests, only one of which writes a COMP_REVOKED audit row.
        if (!plan.isPaid()) {
            throw new IllegalArgumentException(
                    "Free is not something to grant. Remove the household's grant instead.");
        }
        // Mirrors PlanSku.of's rule for what we sell: a tier priced by size needs a size, and a
        // household tier has no seats to set. Refusing the nonsensical combination beats writing a
        // seat count onto a Plus row where nothing will ever read it.
        if (plan == BillingPlan.PRO && band == null) {
            throw new IllegalArgumentException("Pro is licensed by client count - choose a band.");
        }
        if (plan != BillingPlan.PRO && band != null) {
            throw new IllegalArgumentException("Only Pro has client bands.");
        }
        String trimmedNote = note == null || note.isBlank() ? null : note.trim();
        // Rejected rather than truncated: a clipped reason is a worse record than one the admin was
        // asked to shorten, and letting it through would surface as a 500 from the database.
        if (trimmedNote != null && trimmedNote.length() > MAX_NOTE_LENGTH) {
            throw new IllegalArgumentException(
                    "Keep the note to " + MAX_NOTE_LENGTH + " characters or fewer.");
        }

        Account account = requireAccount(accountId);
        Subscription subscription = subscriptionService.getOrCreate(account);

        // A COMP DOES NOT STOP THE MONEY. Nothing here cancels anything at Stripe, so comping a
        // household with a live subscription would leave them paying full price for a plan they had
        // just been given -- the worst possible outcome of a well-meant action, and invisible until
        // the next invoice. Refused outright, with the remedy named, rather than warned about.
        if (blockedByStripe(subscription)) {
            throw new ConflictException(
                    "This household is paying through Stripe. Cancel the subscription in Stripe first,"
                            + " otherwise they would keep being charged for a plan you just gave them.");
        }

        subscription.setComped(true);
        // comped_plan is the authority on a comped row (entitledPlan reads it first); billing_plan
        // is the materialized cache every cheap read uses. Written together, here, so the two
        // cannot disagree -- the same rule applyStripeState follows.
        subscription.setCompedPlan(plan);
        subscription.setPlan(plan);
        // Seats travel with the tier, in the same write, because two writers for one fact is how
        // they drift. Null for a household tier, which has no seats at all.
        subscription.setClientSeats(plan == BillingPlan.PRO ? band.clientLimit() : null);
        subscription.setCompNote(trimmedNote);
        subscriptionRepository.save(subscription);

        auditService.record(accountId, BillingEventType.COMP_GRANTED,
                describeGrant(plan, band, trimmedNote, actorEmail));
        log.info("Comp granted to account {} as {} by {}", accountId, plan, actorEmail);

        // invalidateAccount, not invalidateUser -- a plan change is per-HOUSEHOLD, and picking the
        // wrong axis fails quietly (the cache just keeps answering the old value for a minute).
        // Published rather than called directly because AccountAccessService already depends on
        // SubscriptionService, so billing calling into membership would be a cycle Spring refuses.
        // This method IS @Transactional, so the AFTER_COMMIT listener actually fires -- do not copy
        // TestSupportController's direct invalidate() call, which exists only because its handler is
        // not transactional and the event would be silently discarded there.
        events.publishEvent(new AccountPlanChangedEvent(accountId));

        // Deliberately NOT PlusUpgradedEvent. The welcome-to-Plus email says "thanks for keeping
        // Huddle going", which presumes a purchase that did not happen here. See billing.md.
    }

    /**
     * Take the grant back. The household falls to whatever it is genuinely entitled to, which is
     * FREE unless a Stripe subscription is paying underneath.
     *
     * <p>Nothing is deleted and nothing is revoked. Member logins in the household become
     * {@code PAUSED_PLAN} rather than being removed, every person keeps their history, and
     * re-granting restores the logins with no re-invitation.
     */
    @Transactional
    public void revoke(Long accountId, String actorEmail) {
        Account account = requireAccount(accountId);
        Subscription subscription = subscriptionRepository.findByAccountId(account.getId()).orElse(null);
        // Nothing to take back. Not an error -- the end state the caller asked for already holds,
        // and a 404 here would be a lie about the account.
        if (subscription == null || !subscription.isComped()) {
            return;
        }

        BillingPlan removed = subscription.getCompedPlan();
        subscription.setComped(false);
        subscription.setCompedPlan(null);
        subscription.setCompNote(null);

        // Recompute rather than assume FREE: a household can hold a comp AND a paying Stripe
        // subscription (a comp added to a lapsed row that has since been revived). Clamping to FREE
        // would cut off somebody who is actually paying. Mirrors applyPurchasedTier's !entitled
        // branch -- billing_plan is a cache, and leaving it reading PLUS after the grant is gone
        // strands it.
        if (!subscriptionService.isPayingThroughStripe(subscription)) {
            subscription.setPlan(BillingPlan.FREE);
            subscription.setClientSeats(null);
        }
        subscriptionRepository.save(subscription);

        auditService.record(accountId, BillingEventType.COMP_REVOKED,
                "Comp removed (was " + (removed == null ? "PLUS" : removed.name()) + ") by " + actorEmail);
        log.info("Comp revoked from account {} by {}", accountId, actorEmail);

        events.publishEvent(new AccountPlanChangedEvent(accountId));
    }

    /**
     * Would granting a comp here leave the household still being charged?
     *
     * <p>THE SINGLE DEFINITION of the refusal in {@link #grant}, shared with {@code AdminService} so
     * the Accounts tab can disable the control rather than offer a write the server will refuse
     * ({@code .claude/rules/member-access.md}). Deliberately shared rather than mirrored -- both
     * callers are in this JVM, so there is no reason to keep two copies in step by hand.
     *
     * <p>Asks {@code isPayingThroughStripe}, never {@code isEntitled}: the latter is true for an
     * already-comped row, which would make every comped household permanently un-editable.
     * Requiring a subscription id as well keeps a hand-edited or half-migrated row (a status with no
     * Stripe object behind it) from latching the control off forever.
     */
    public boolean blockedByStripe(Subscription subscription) {
        return subscription != null
                && subscription.getStripeSubscriptionId() != null
                && subscriptionService.isPayingThroughStripe(subscription);
    }

    private Account requireAccount(Long accountId) {
        if (accountId == null) {
            throw new IllegalArgumentException("Account id is required.");
        }
        return accountRepository.findById(accountId)
                .orElseThrow(() -> new NotFoundException("Household not found"));
    }

    private String describeGrant(BillingPlan plan, ClientBand band, String note, String actorEmail) {
        // The audit row has to answer "who gave what to whom, and why" on its own -- a detail that
        // merely restates the event type is a wasted row (BillingEventType's header).
        StringBuilder detail = new StringBuilder("Comped ").append(plan.name());
        if (band != null) {
            detail.append(" (").append(band.name()).append(", ")
                    .append(band.clientLimit() == null ? "unlimited" : band.clientLimit() + " clients")
                    .append(")");
        }
        detail.append(" by ").append(actorEmail);
        if (note != null) {
            detail.append(" - ").append(note);
        }
        return detail.toString();
    }
}
