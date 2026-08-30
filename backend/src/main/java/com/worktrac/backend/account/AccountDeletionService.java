package com.worktrac.backend.account;

import com.worktrac.backend.billing.BillingEventRepository;
import com.worktrac.backend.billing.StripeSubscriptionCanceller;
import com.worktrac.backend.billing.SubscriptionRepository;
import com.worktrac.backend.contact.ContactMessageRepository;
import com.worktrac.backend.common.UnauthorizedException;
import com.worktrac.backend.csvimport.ImportBatchCleanup;
import com.worktrac.backend.exercise.ExerciseRepository;
import com.worktrac.backend.person.PersonRepository;
import com.worktrac.backend.tag.TagRepository;
import com.worktrac.backend.user.User;
import com.worktrac.backend.user.UserRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

import java.util.List;

// Permanently erases an account and everything under it. Order matters: people must go
// first so the existing DB cascades (routines/routine_exercises, workout_sessions/
// workout_sets, person_exercise -> person_exercise_fields/person_exercise_tags) fire and
// clear the FK rows that still reference this account's exercises
// (routine_exercises.exercise_id, workout_sets.exercise_id have no cascade of their own).
// Tags are account-scoped and cleared explicitly below. Only rows with this exact account_id
// are ever touched -- global/shared library exercises (NULL account_id) are never selected.
@Service
public class AccountDeletionService {

    private static final Logger log = LoggerFactory.getLogger(AccountDeletionService.class);

    private final StripeSubscriptionCanceller stripeSubscriptionCanceller;
    private final SubscriptionRepository subscriptionRepository;
    private final BillingEventRepository billingEventRepository;
    private final ContactMessageRepository contactMessageRepository;
    private final ImportBatchCleanup importBatchCleanup;
    private final PersonRepository personRepository;
    private final ExerciseRepository exerciseRepository;
    private final TagRepository tagRepository;
    private final UserRepository userRepository;
    private final AccountRepository accountRepository;
    private final PasswordEncoder passwordEncoder;

    public AccountDeletionService(StripeSubscriptionCanceller stripeSubscriptionCanceller,
                                   SubscriptionRepository subscriptionRepository,
                                   BillingEventRepository billingEventRepository,
                                   ContactMessageRepository contactMessageRepository,
                                   ImportBatchCleanup importBatchCleanup, PersonRepository personRepository,
                                   ExerciseRepository exerciseRepository,
                                   TagRepository tagRepository, UserRepository userRepository,
                                   AccountRepository accountRepository, PasswordEncoder passwordEncoder) {
        this.stripeSubscriptionCanceller = stripeSubscriptionCanceller;
        this.subscriptionRepository = subscriptionRepository;
        this.billingEventRepository = billingEventRepository;
        this.contactMessageRepository = contactMessageRepository;
        this.importBatchCleanup = importBatchCleanup;
        this.personRepository = personRepository;
        this.exerciseRepository = exerciseRepository;
        this.tagRepository = tagRepository;
        this.userRepository = userRepository;
        this.accountRepository = accountRepository;
        this.passwordEncoder = passwordEncoder;
    }

    @Transactional
    public void deleteAccount(Long accountId, Long userId, String password) {
        // Re-authenticate before erasing anything. Typing DELETE proves intent, but only the
        // password proves the person at the keyboard is the account holder -- and the bearer
        // token that got them here is valid for 30 days with no revocation, so on its own it is
        // a weak thing to hang an irreversible, unrecoverable action on.
        //
        // 401 rather than 403: the request is well-formed and the caller is allowed to delete
        // their own account, they just have not proved who they are.
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new UnauthorizedException("User no longer exists"));
        if (!passwordEncoder.matches(password, user.getPasswordHash())) {
            log.warn("Refused account deletion for account {}: incorrect password", accountId);
            throw new UnauthorizedException("That password is not correct.");
        }

        // Read the subscription id while its row still exists; the Stripe call itself happens
        // after this transaction commits (see the afterCommit hook below, and
        // StripeSubscriptionCanceller for why that ordering is load-bearing).
        String stripeSubscriptionId = stripeSubscriptionCanceller.pendingCancellation(accountId);

        // FIRST: contact_messages holds NO ACTION FKs to accounts, users AND people, so every
        // delete below this line fails with a constraint violation while a submission is still
        // around -- which meant any household that had ever used Contact Us could not delete its
        // account at all. It surfaced as a 503 (DataAccessException) from an irreversible action
        // the person had already confirmed, with no path forward.
        //
        // TestDataCleanupService hit the identical constraint in e2e teardown and already clears
        // this table first; that fix was never carried across to the user-facing path. The two
        // orderings must stay in step.
        contactMessageRepository.deleteByAccountIdIn(List.of(accountId));
        // Billing next: subscriptions has a NO ACTION FK to accounts (see V56), so it must go
        // before the account it points at. billing_events carries a plain account_id column with
        // no FK, but goes here for the same reason -- an erased household leaves nothing behind.
        subscriptionRepository.deleteByAccountIdIn(List.of(accountId));
        billingEventRepository.deleteByAccountIdIn(List.of(accountId));
        // Before people: import_batches has a non-cascading FK to people, and the workout rows
        // it stamped are cleared rather than deleted here. ImportBatchCleanup explains why that
        // is the only order the constraints allow.
        importBatchCleanup.deleteForAccounts(List.of(accountId));
        personRepository.deleteByAccount_Id(accountId);
        exerciseRepository.deleteByAccount_Id(accountId);
        tagRepository.deleteByAccount_Id(accountId);
        userRepository.deleteByAccount_Id(accountId);
        accountRepository.deleteById(accountId);
        log.info("Deleted account {}", accountId);

        cancelAtStripeAfterCommit(accountId, stripeSubscriptionId);
    }

    // Stopping the money is deliberately the LAST thing, and it happens outside this transaction.
    //
    // Cancelling at Stripe is an external side effect that cannot roll back. Done before the
    // deletes, any failure further down left the household with their subscription cancelled and
    // their account fully intact -- they lost the Pro they were paying for and kept the data they
    // asked to erase, having been told the operation failed. Running it on afterCommit means it
    // only ever fires for an account that actually went away.
    //
    // It also has to run after billing_events has been cleared: the canceller records its own
    // failure as a BillingEvent, described in its comments as the only remaining record of what
    // needs cancelling by hand, and clearing that table afterwards deleted exactly that row.
    private void cancelAtStripeAfterCommit(Long accountId, String stripeSubscriptionId) {
        if (stripeSubscriptionId == null) {
            return;
        }
        if (!TransactionSynchronizationManager.isSynchronizationActive()) {
            // No surrounding transaction to hang the callback off (a direct call outside Spring's
            // transaction management). Nothing has been rolled back in that case either, so
            // running it inline is still correct.
            stripeSubscriptionCanceller.cancel(accountId, stripeSubscriptionId);
            return;
        }
        TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
            @Override
            public void afterCommit() {
                stripeSubscriptionCanceller.cancel(accountId, stripeSubscriptionId);
            }
        });
    }
}
