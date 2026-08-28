package com.worktrac.backend.account;

import com.worktrac.backend.billing.BillingEventRepository;
import com.worktrac.backend.billing.StripeSubscriptionCanceller;
import com.worktrac.backend.billing.SubscriptionRepository;
import com.worktrac.backend.csvimport.ImportBatchCleanup;
import com.worktrac.backend.exercise.ExerciseRepository;
import com.worktrac.backend.person.PersonRepository;
import com.worktrac.backend.tag.TagRepository;
import com.worktrac.backend.user.UserRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

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
    private final ImportBatchCleanup importBatchCleanup;
    private final PersonRepository personRepository;
    private final ExerciseRepository exerciseRepository;
    private final TagRepository tagRepository;
    private final UserRepository userRepository;
    private final AccountRepository accountRepository;

    public AccountDeletionService(StripeSubscriptionCanceller stripeSubscriptionCanceller,
                                   SubscriptionRepository subscriptionRepository,
                                   BillingEventRepository billingEventRepository,
                                   ImportBatchCleanup importBatchCleanup, PersonRepository personRepository,
                                   ExerciseRepository exerciseRepository,
                                   TagRepository tagRepository, UserRepository userRepository,
                                   AccountRepository accountRepository) {
        this.stripeSubscriptionCanceller = stripeSubscriptionCanceller;
        this.subscriptionRepository = subscriptionRepository;
        this.billingEventRepository = billingEventRepository;
        this.importBatchCleanup = importBatchCleanup;
        this.personRepository = personRepository;
        this.exerciseRepository = exerciseRepository;
        this.tagRepository = tagRepository;
        this.userRepository = userRepository;
        this.accountRepository = accountRepository;
    }

    @Transactional
    public void deleteAccount(Long accountId) {
        // Billing first: subscriptions has a NO ACTION FK to accounts (see V56), so it must go
        // before the account it points at. billing_events carries a plain account_id column with
        // no FK, but goes here for the same reason -- an erased household leaves nothing behind.
        //
        // Stop the money BEFORE the row naming the subscription is gone. Best-effort by design
        // (see StripeSubscriptionCanceller): a Stripe outage must not be able to block someone
        // from deleting their account, which is a right rather than a convenience.
        stripeSubscriptionCanceller.cancelForAccount(accountId);
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
    }
}
