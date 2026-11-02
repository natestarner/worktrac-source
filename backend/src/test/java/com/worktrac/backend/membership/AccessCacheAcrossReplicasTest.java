package com.worktrac.backend.membership;

import com.worktrac.backend.account.Account;
import com.worktrac.backend.account.AccountRepository;
import com.worktrac.backend.billing.SubscriptionService;
import com.worktrac.backend.email.EmailService;
import com.worktrac.backend.person.Person;
import com.worktrac.backend.person.PersonRepository;
import com.worktrac.backend.support.AbstractIntegrationTest;
import com.worktrac.backend.user.User;
import com.worktrac.backend.user.UserRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.Clock;
import java.time.Instant;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

// Two replicas share one database and nothing else. "Replica A" is the context's own
// AccountAccessService, used by every service that changes access. "Replica B" is a second
// AccountAccessService + poller built from the same beans: its cache is its own instance, exactly as
// a second JVM's would be. Each case first warms B's cache, makes the change through A, then asks B.
//
// The token-newer cases need no poll at all -- that is their point: the request carrying the new
// token must work on a replica that has not heard about the change yet.
@DisplayName("the access cache stays correct across replicas")
class AccessCacheAcrossReplicasTest extends AbstractIntegrationTest {

    @DynamicPropertySource
    static void datasource(DynamicPropertyRegistry registry) {
        registerDatasource(registry, AccessCacheAcrossReplicasTest.class);
    }

    @MockitoBean
    private EmailService emailService;

    @Autowired
    private AccountAccessService replicaA;

    @Autowired
    private AccountMembershipRepository membershipRepository;

    @Autowired
    private SubscriptionService subscriptionService;

    @Autowired
    private AccessInvalidationLog invalidationLog;

    @Autowired
    private Clock clock;

    @Autowired
    private AccountRepository accountRepository;

    @Autowired
    private UserRepository userRepository;

    @Autowired
    private PersonRepository personRepository;

    @Autowired
    private TransactionTemplate transactionTemplate;

    private AccountAccessService replicaB;
    private AccessInvalidationPoller pollerB;

    private Account account;
    private User user;

    @BeforeEach
    void setUp() {
        replicaB = new AccountAccessService(membershipRepository, subscriptionService, invalidationLog, clock);
        pollerB = new AccessInvalidationPoller(invalidationLog, replicaB);

        String suffix = UUID.randomUUID().toString().substring(0, 8);
        account = accountRepository.save(new Account("Household " + suffix));
        user = userRepository.save(new User("owner-" + suffix + "@example.com", "hash"));
        Person person = personRepository.save(new Person(account, "Pat", false));
        membershipRepository.save(new AccountMembership(account, user, person, AccountRole.OWNER));
    }

    private int currentTokenVersion() {
        return userRepository.findById(user.getId()).orElseThrow().getTokenVersion();
    }

    @Test
    void aPasswordChangeOnOneReplicaDoesNotSignThePersonOutOnAnother() {
        int before = currentTokenVersion();
        assertThat(replicaB.resolve(user.getId(), account.getId(), before, Instant.now())).isPresent();

        // What PasswordChangeService does on replica A: bump the version, invalidate, mint a token.
        transactionTemplate.executeWithoutResult(status -> {
            User fresh = userRepository.findById(user.getId()).orElseThrow();
            fresh.bumpTokenVersion();
            userRepository.save(fresh);
        });
        replicaA.invalidateUser(user.getId());
        int after = currentTokenVersion();

        // The new token's very next request lands on B, before B has polled. It must not be a 401.
        assertThat(replicaB.resolve(user.getId(), account.getId(), after, Instant.now()))
                .as("the new token must be accepted by a replica whose cache predates it")
                .isPresent();
        // ...and the old token is refused there too, without waiting for anything.
        assertThat(replicaB.resolve(user.getId(), account.getId(), before, Instant.now())).isEmpty();
    }

    @Test
    void aMembershipCreatedAfterAReplicaCachedItsAbsenceIsSeenByANewerToken() {
        Account other = accountRepository.save(new Account("Second household"));
        Person otherPerson = personRepository.save(new Person(other, "Pat", false));
        int version = currentTokenVersion();
        Instant longAgo = Instant.now().minusSeconds(3600);

        // B is asked about a household this login is not in yet, and caches "no".
        assertThat(replicaB.resolve(user.getId(), other.getId(), version, longAgo)).isEmpty();

        // The invite is accepted on replica A.
        membershipRepository.save(new AccountMembership(other, user, otherPerson, AccountRole.MEMBER));
        replicaA.invalidate(user.getId(), other.getId());

        // An OLD token retried against B is still answered from the cache -- no read, no access.
        assertThat(replicaB.resolve(user.getId(), other.getId(), version, longAgo)).isEmpty();
        // The token minted by the accept is newer than B's "no", so B re-reads and lets it in.
        assertThat(replicaB.resolve(user.getId(), other.getId(), version, Instant.now().plusSeconds(1)))
                .as("a token issued after the cached absence must re-read")
                .isPresent();
    }

    @Test
    void aRevokedLoginStopsWorkingOnEveryReplicaAfterOnePoll() {
        int version = currentTokenVersion();
        assertThat(replicaB.resolve(user.getId(), account.getId(), version, Instant.now())).isPresent();

        transactionTemplate.executeWithoutResult(status ->
                membershipRepository.delete(membershipRepository.findByAccount_Id(account.getId()).getFirst()));
        replicaA.invalidate(user.getId(), account.getId());

        pollerB.applyRecentInvalidations();

        assertThat(replicaB.resolve(user.getId(), account.getId(), version, Instant.now()))
                .as("replica B must drop the revoked membership on its next poll, not a minute later")
                .isEmpty();
    }

    @Test
    void anAccountWideChangeReachesEveryReplicaAfterOnePoll() {
        int version = currentTokenVersion();
        AccountAccess warm = replicaB.resolve(user.getId(), account.getId(), version, Instant.now()).orElseThrow();
        assertThat(warm.accountRole()).isEqualTo(AccountRole.OWNER);

        transactionTemplate.executeWithoutResult(status -> {
            AccountMembership membership = membershipRepository.findByAccount_Id(account.getId()).getFirst();
            membershipRepository.delete(membership);
        });
        replicaA.invalidateAccount(account.getId());

        pollerB.applyRecentInvalidations();

        assertThat(replicaB.resolve(user.getId(), account.getId(), version, Instant.now())).isEmpty();
    }

    @Test
    void aReplicaThatHasNotPolledStillAnswersFromItsCache() {
        // The control for the two poll cases above: without the poll, B is stale. If this ever
        // fails, those cases are passing for some other reason and prove nothing.
        int version = currentTokenVersion();
        assertThat(replicaB.resolve(user.getId(), account.getId(), version, Instant.now())).isPresent();

        transactionTemplate.executeWithoutResult(status ->
                membershipRepository.delete(membershipRepository.findByAccount_Id(account.getId()).getFirst()));
        replicaA.invalidate(user.getId(), account.getId());

        assertThat(replicaB.resolve(user.getId(), account.getId(), version, Instant.now())).isPresent();
    }
}
