package com.worktrac.backend.admin;

import com.worktrac.backend.account.AccountDeletionService;
import com.worktrac.backend.registrationaudit.RegistrationEventRepository;
import com.worktrac.backend.user.PendingRegistrationRepository;
import com.worktrac.backend.user.User;
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
@Service
public class TestDataCleanupService {

    private static final Logger log = LoggerFactory.getLogger(TestDataCleanupService.class);

    static final String E2E_EMAIL_PATTERN = "e2e-%@example.com";

    private final UserRepository userRepository;
    private final AccountDeletionService accountDeletionService;
    private final RegistrationEventRepository registrationEventRepository;
    private final PendingRegistrationRepository pendingRegistrationRepository;

    public TestDataCleanupService(UserRepository userRepository, AccountDeletionService accountDeletionService,
                                   RegistrationEventRepository registrationEventRepository,
                                   PendingRegistrationRepository pendingRegistrationRepository) {
        this.userRepository = userRepository;
        this.accountDeletionService = accountDeletionService;
        this.registrationEventRepository = registrationEventRepository;
        this.pendingRegistrationRepository = pendingRegistrationRepository;
    }

    @Transactional(readOnly = true)
    public AdminTestDataPreviewDto preview() {
        long accountCount = userRepository.findByEmailLike(E2E_EMAIL_PATTERN).size();
        long eventCount = registrationEventRepository.countByEmailLike(E2E_EMAIL_PATTERN);
        long pendingCount = pendingRegistrationRepository.countByEmailLike(E2E_EMAIL_PATTERN);
        return new AdminTestDataPreviewDto(accountCount, eventCount, pendingCount);
    }

    @Transactional
    public AdminTestDataPreviewDto deleteAll() {
        List<User> testUsers = userRepository.findByEmailLike(E2E_EMAIL_PATTERN);
        long eventCount = registrationEventRepository.countByEmailLike(E2E_EMAIL_PATTERN);
        long pendingCount = pendingRegistrationRepository.countByEmailLike(E2E_EMAIL_PATTERN);

        for (User user : testUsers) {
            accountDeletionService.deleteAccount(user.getAccount().getId());
        }
        registrationEventRepository.deleteByEmailLike(E2E_EMAIL_PATTERN);
        pendingRegistrationRepository.deleteByEmailLike(E2E_EMAIL_PATTERN);

        log.info("Deleted e2e test data: {} accounts, {} registration events, {} pending registrations",
                testUsers.size(), eventCount, pendingCount);
        return new AdminTestDataPreviewDto(testUsers.size(), eventCount, pendingCount);
    }
}
