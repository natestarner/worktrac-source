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

import java.util.ArrayList;
import java.util.List;
import java.util.function.ToLongFunction;

// Lets an admin wipe every trace of the Playwright e2e suite's own test data from a
// non-production database on demand, to clear the noise it creates in the Activity/Pending/
// Accounts views. Deliberately its own service (not folded into AdminService) -- unlike that
// class's one narrow read-only-portal exception (the alert-settings toggle), this genuinely,
// irreversibly deletes rows, and keeping it separate makes that boundary obvious at a glance
// rather than diluting AdminService's own "read-only except..." class comment further.
//
// Identification matches TWO precise patterns, not a heuristic:
// - CURRENT_EMAIL_PATTERN ("huddle+<...>@starner.co") -- every e2e spec creates its test
//   households through exactly one shared helper (e2e/tests/support/auth.ts's
//   registerHousehold), which generates "huddle+e2e-<timestamp>-<random>@starner.co", a
//   plus-addressed sub-address of a real mailbox the team controls specifically to receive e2e
//   traffic. Deliberately broader than just the "huddle+e2e-" prefix EmailService's no-op check
//   uses (see EmailProperties.e2eNoopRecipientPattern) -- it also needs to catch
//   "huddle+livewiretest-..." (live-email-canary.spec.ts's real-send canary, which must NOT
//   match the no-op pattern, but still creates accounts that need cleaning up like any other
//   e2e run). A genuine user would need to own huddle@starner.co to ever match either.
// - LEGACY_EMAIL_PATTERN ("e2e-<...>@example.com") -- the pattern used before the 2026-08-02
//   mailbox switch (see CLAUDE.md), retained so any backlog of pre-switch accounts already
//   sitting in a database (created back when every send bounced against the IANA-reserved
//   example.com) can still be cleaned up. Safe to remove once that backlog is confirmed empty
//   in every environment.
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

    static final String CURRENT_EMAIL_PATTERN = "huddle+%@starner.co";
    static final String LEGACY_EMAIL_PATTERN = "e2e-%@example.com";
    private static final List<String> EMAIL_PATTERNS = List.of(CURRENT_EMAIL_PATTERN, LEGACY_EMAIL_PATTERN);

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
        long accountCount = matchingAccountIds().size();
        long eventCount = countAcrossPatterns(registrationEventRepository::countByEmailLike);
        long pendingCount = countAcrossPatterns(pendingRegistrationRepository::countByEmailLike);
        return new AdminTestDataPreviewDto(accountCount, eventCount, pendingCount);
    }

    @Transactional
    public AdminTestDataPreviewDto deleteAll() {
        List<Long> accountIds = matchingAccountIds();
        long eventCount = countAcrossPatterns(registrationEventRepository::countByEmailLike);
        long pendingCount = countAcrossPatterns(pendingRegistrationRepository::countByEmailLike);

        if (!accountIds.isEmpty()) {
            personRepository.deleteByAccountIdIn(accountIds);
            exerciseRepository.deleteByAccountIdIn(accountIds);
            tagRepository.deleteByAccountIdIn(accountIds);
            userRepository.deleteByAccountIdIn(accountIds);
            accountRepository.deleteAllByIdInBatch(accountIds);
        }
        EMAIL_PATTERNS.forEach(registrationEventRepository::deleteByEmailLikeBulk);
        EMAIL_PATTERNS.forEach(pendingRegistrationRepository::deleteByEmailLikeBulk);

        log.info("Deleted e2e test data: {} accounts, {} registration events, {} pending registrations",
                accountIds.size(), eventCount, pendingCount);
        return new AdminTestDataPreviewDto(accountIds.size(), eventCount, pendingCount);
    }

    // Patterns are mutually exclusive (one anchors on @starner.co, the other on @example.com),
    // so simple concatenation across both never double-counts an account.
    private List<Long> matchingAccountIds() {
        List<Long> ids = new ArrayList<>();
        EMAIL_PATTERNS.forEach(pattern -> ids.addAll(userRepository.findAccountIdsByEmailLike(pattern)));
        return ids;
    }

    private long countAcrossPatterns(ToLongFunction<String> countByPattern) {
        return EMAIL_PATTERNS.stream().mapToLong(countByPattern).sum();
    }
}
