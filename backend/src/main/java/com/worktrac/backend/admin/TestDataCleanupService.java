package com.worktrac.backend.admin;

import com.worktrac.backend.account.AccountRepository;
import com.worktrac.backend.exercise.ExerciseRepository;
import com.worktrac.backend.person.PersonRepository;
import com.worktrac.backend.registrationaudit.RegistrationEventRepository;
import com.worktrac.backend.tag.TagRepository;
import com.worktrac.backend.user.PendingRegistrationRepository;
import com.worktrac.backend.user.UserRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

// Lets an admin wipe every trace of the Playwright e2e suite's own test data from a
// non-production database on demand, to clear the noise it creates in the Activity/Pending/
// Accounts views. Deliberately its own service (not folded into AdminService) -- unlike that
// class's one narrow read-only-portal exception (the alert-settings toggle), this genuinely,
// irreversibly deletes rows, and keeping it separate makes that boundary obvious at a glance
// rather than diluting AdminService's own "read-only except..." class comment further.
//
// Identification is a single, precise pattern: every one of this app's ~30 e2e specs creates
// its test households through exactly one shared helper (e2e/tests/support/auth.ts's
// registerHousehold), which always generates emails as "e2e-<timestamp>-<random>@example.com".
// example.com is an IANA-reserved (RFC 2606) domain that can never resolve to a real mailbox, so
// combined with the "e2e-" prefix this can never accidentally match a genuine user's email.
//
// The stronger safety net is TestDataAdminController's own @Profile({"local", "lower"}) --
// this service itself has no environment check, because the routes that call it simply don't
// exist as beans in production at all (see that controller's own comment).
//
// deleteAll() deliberately does NOT reuse AccountDeletionService.deleteAccount(Long) in a loop
// over every matching account, unlike an earlier version of this class. Lower had accumulated
// hundreds of e2e accounts across repeated deploys' e2e runs, and Spring Data JPA's derived
// deleteByAccount_Id (used by that per-account cascade) loads and removes every matching entity
// one at a time rather than issuing a single DELETE statement -- looping it once per account
// made this endpoint's total DB round trips scale with (test accounts) x (tables x rows per
// account), which took long enough in lower to exceed the frontend's request timeout. The
// timeout didn't cancel the still-running backend transaction, and that transaction's DB load
// is suspected to have contributed to a real production-adjacent incident where an unrelated
// registration's async email dispatch silently never ran (see AsyncConfig's CallerRunsPolicy
// comment). Every table below is instead cleared with one bulk `DELETE ... WHERE ... IN (...)`
// statement across every matching account at once (see e.g. PersonRepository.deleteByAccountIdIn),
// and accounts themselves via Spring Data's own deleteAllByIdInBatch. Order still matters for
// the same FK reasons as AccountDeletionService (people before the exercises/tags/user rows they
// may reference, all before the account row itself).
@Service
public class TestDataCleanupService {

    private static final Logger log = LoggerFactory.getLogger(TestDataCleanupService.class);

    static final String E2E_EMAIL_PATTERN = "e2e-%@example.com";

    private final UserRepository userRepository;
    private final PersonRepository personRepository;
    private final ExerciseRepository exerciseRepository;
    private final TagRepository tagRepository;
    private final AccountRepository accountRepository;
    private final RegistrationEventRepository registrationEventRepository;
    private final PendingRegistrationRepository pendingRegistrationRepository;

    public TestDataCleanupService(UserRepository userRepository, PersonRepository personRepository,
                                   ExerciseRepository exerciseRepository, TagRepository tagRepository,
                                   AccountRepository accountRepository,
                                   RegistrationEventRepository registrationEventRepository,
                                   PendingRegistrationRepository pendingRegistrationRepository) {
        this.userRepository = userRepository;
        this.personRepository = personRepository;
        this.exerciseRepository = exerciseRepository;
        this.tagRepository = tagRepository;
        this.accountRepository = accountRepository;
        this.registrationEventRepository = registrationEventRepository;
        this.pendingRegistrationRepository = pendingRegistrationRepository;
    }

    @Transactional(readOnly = true)
    public AdminTestDataPreviewDto preview() {
        long accountCount = userRepository.findAccountIdsByEmailLike(E2E_EMAIL_PATTERN).size();
        long eventCount = registrationEventRepository.countByEmailLike(E2E_EMAIL_PATTERN);
        long pendingCount = pendingRegistrationRepository.countByEmailLike(E2E_EMAIL_PATTERN);
        return new AdminTestDataPreviewDto(accountCount, eventCount, pendingCount);
    }

    @Transactional
    public AdminTestDataPreviewDto deleteAll() {
        List<Long> accountIds = userRepository.findAccountIdsByEmailLike(E2E_EMAIL_PATTERN);
        long eventCount = registrationEventRepository.countByEmailLike(E2E_EMAIL_PATTERN);
        long pendingCount = pendingRegistrationRepository.countByEmailLike(E2E_EMAIL_PATTERN);

        if (!accountIds.isEmpty()) {
            personRepository.deleteByAccountIdIn(accountIds);
            exerciseRepository.deleteByAccountIdIn(accountIds);
            tagRepository.deleteByAccountIdIn(accountIds);
            userRepository.deleteByAccountIdIn(accountIds);
            accountRepository.deleteAllByIdInBatch(accountIds);
        }
        registrationEventRepository.deleteByEmailLikeBulk(E2E_EMAIL_PATTERN);
        pendingRegistrationRepository.deleteByEmailLikeBulk(E2E_EMAIL_PATTERN);

        log.info("Deleted e2e test data: {} accounts, {} registration events, {} pending registrations",
                accountIds.size(), eventCount, pendingCount);
        return new AdminTestDataPreviewDto(accountIds.size(), eventCount, pendingCount);
    }
}
