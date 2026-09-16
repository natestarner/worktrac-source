package com.worktrac.backend.account;

import com.worktrac.backend.billing.PlanFeature;
import com.worktrac.backend.billing.SubscriptionService;
import com.worktrac.backend.common.ConflictException;
import com.worktrac.backend.common.NotFoundException;
import com.worktrac.backend.membership.AccountAccessService;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class AccountService {

    private final AccountRepository accountRepository;
    private final SubscriptionService subscriptionService;
    private final AccountAccessService accountAccessService;

    public AccountService(AccountRepository accountRepository, SubscriptionService subscriptionService,
                           AccountAccessService accountAccessService) {
        this.accountRepository = accountRepository;
        this.subscriptionService = subscriptionService;
        this.accountAccessService = accountAccessService;
    }

    // Applies only to newly logged sets from now on -- already-logged sets keep the
    // unit they were recorded in (see Set.unit's stamping-at-log-time rule).
    @Transactional
    public AccountDto updateDefaultUnit(Long accountId, String defaultUnit) {
        Account account = accountRepository.findById(accountId)
                .orElseThrow(() -> new NotFoundException("We couldn't find that account."));
        account.setDefaultUnit(defaultUnit);
        return AccountDto.from(account, subscriptionService.entitledPlan(accountId));
    }

    /**
     * Whether members of this account see everyone in it, or only themselves.
     *
     * <p>⚠️ THE ONLY CALLER OF {@code Account.setMembersSeeEveryone}, and the gate is here rather
     * than in the entity because it is a PLAN question, not a data-integrity one. A plan without
     * {@code PRIVATE_MEMBERS} keeps the family default — everyone sees everyone — which is what a
     * household expects and what the app has always done.
     *
     * <p>A 409 rather than a 403: the caller holds {@code MANAGE_HOUSEHOLD} perfectly well and will
     * be able to do exactly this the moment the account is on Pro. 403 would say "not you", which
     * is the wrong diagnosis and points at the wrong fix — the same reasoning
     * {@code MembershipInviteService.invite} uses for the Plus gate on invitations.
     *
     * <p>⚠️ Nothing calls this on a DOWNGRADE, deliberately. A Pro account that lapses keeps
     * {@code members_see_everyone = false}: flipping it back to the family default would expose
     * every client's training to every other client as a side effect of a billing lapse, which is
     * the single worst thing this feature could do. The clients' logins pause (they cannot see
     * anything at all), and the setting is waiting, correct, when the account returns to Pro. Same
     * shape as the Plus pause: nothing is deleted and nothing is revoked.
     */
    @Transactional
    public AccountDto setMemberVisibility(Long accountId, boolean membersSeeEveryone) {
        Account account = accountRepository.findById(accountId)
                .orElseThrow(() -> new NotFoundException("We couldn't find that account."));
        if (!subscriptionService.has(accountId, PlanFeature.PRIVATE_MEMBERS)) {
            throw new ConflictException(
                    "Keeping people's workouts private to them is part of Huddle Pro.");
        }
        account.setMembersSeeEveryone(membersSeeEveryone);
        // Every member's cached AccountAccess carries this value, so without the invalidation the
        // change takes up to the cache TTL to bite -- and the direction that matters is turning
        // privacy ON, where a minute of a client still seeing a sibling is exactly the leak the
        // setting exists to close. Same axis AccountPlanChangedListener uses: per-ACCOUNT.
        accountAccessService.invalidateAccount(accountId);
        return AccountDto.from(account, subscriptionService.entitledPlan(accountId));
    }
}
