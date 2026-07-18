package com.worktrac.backend.admin;

import com.worktrac.backend.account.Account;
import com.worktrac.backend.account.AccountRepository;
import com.worktrac.backend.person.Person;
import com.worktrac.backend.person.PersonRepository;
import com.worktrac.backend.user.PendingRegistration;
import com.worktrac.backend.user.PendingRegistrationRepository;
import com.worktrac.backend.user.UserRepository;
import com.worktrac.backend.workoutsession.WorkoutSessionRepository;
import com.worktrac.backend.workoutset.WorkoutSetRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

// The one place in the app that deliberately reads across every account instead of
// scoping to CurrentUser.accountId() -- gated at the route level in SecurityConfig
// (/api/admin/** -> hasRole('ADMIN')). Read-only: no method here mutates app data.
@Service
public class AdminService {

    private final AccountRepository accountRepository;
    private final UserRepository userRepository;
    private final PersonRepository personRepository;
    private final WorkoutSessionRepository workoutSessionRepository;
    private final WorkoutSetRepository workoutSetRepository;
    private final PendingRegistrationRepository pendingRegistrationRepository;
    private final Clock clock;

    public AdminService(AccountRepository accountRepository, UserRepository userRepository,
                         PersonRepository personRepository, WorkoutSessionRepository workoutSessionRepository,
                         WorkoutSetRepository workoutSetRepository,
                         PendingRegistrationRepository pendingRegistrationRepository, Clock clock) {
        this.accountRepository = accountRepository;
        this.userRepository = userRepository;
        this.personRepository = personRepository;
        this.workoutSessionRepository = workoutSessionRepository;
        this.workoutSetRepository = workoutSetRepository;
        this.pendingRegistrationRepository = pendingRegistrationRepository;
        this.clock = clock;
    }

    @Transactional(readOnly = true)
    public AdminOverviewDto overview() {
        Instant now = clock.instant();
        Instant sevenDaysAgo = now.minus(Duration.ofDays(7));
        Instant thirtyDaysAgo = now.minus(Duration.ofDays(30));

        return new AdminOverviewDto(
                accountRepository.count(),
                userRepository.count(),
                personRepository.count(),
                workoutSessionRepository.count(),
                workoutSetRepository.count(),
                userRepository.countByCreatedAtAfter(sevenDaysAgo),
                userRepository.countByCreatedAtAfter(thirtyDaysAgo),
                workoutSessionRepository.countDistinctActiveAccountsSince(sevenDaysAgo),
                workoutSessionRepository.countDistinctActiveAccountsSince(thirtyDaysAgo),
                pendingRegistrationRepository.count());
    }

    @Transactional(readOnly = true)
    public List<AdminAccountDto> listAccounts() {
        Map<Long, String> primaryNameByAccount = toStringMap(personRepository.primaryNameGroupedByAccount());
        Map<Long, String> emailByAccount = toStringMap(userRepository.emailGroupedByAccount());
        Map<Long, String> roleByAccount = toStringMap(userRepository.roleGroupedByAccount());
        Map<Long, Long> peopleCountByAccount = toLongMap(personRepository.countGroupedByAccount());
        Map<Long, Long> sessionCountByAccount = toLongMap(workoutSessionRepository.countGroupedByAccount());
        Map<Long, Long> setCountByAccount = toLongMap(workoutSetRepository.countGroupedByAccount());
        Map<Long, Instant> lastActivityByAccount = toInstantMap(
                workoutSessionRepository.lastActivityGroupedByAccount());

        return accountRepository.findAll().stream()
                .sorted(Comparator.comparing(Account::getCreatedAt).reversed())
                .map(account -> new AdminAccountDto(
                        account.getId(),
                        account.getName(),
                        primaryNameByAccount.get(account.getId()),
                        emailByAccount.get(account.getId()),
                        roleByAccount.get(account.getId()),
                        account.getDefaultUnit(),
                        account.getCreatedAt(),
                        peopleCountByAccount.getOrDefault(account.getId(), 0L),
                        sessionCountByAccount.getOrDefault(account.getId(), 0L),
                        setCountByAccount.getOrDefault(account.getId(), 0L),
                        lastActivityByAccount.get(account.getId())))
                .toList();
    }

    @Transactional(readOnly = true)
    public List<AdminPersonDto> listPeople() {
        Map<Long, String> emailByAccount = toStringMap(userRepository.emailGroupedByAccount());

        return personRepository.findAllWithAccount().stream()
                .map(person -> toAdminPersonDto(person, emailByAccount))
                .toList();
    }

    @Transactional(readOnly = true)
    public List<AdminPendingRegistrationDto> listPendingRegistrations() {
        return pendingRegistrationRepository.findAll().stream()
                .sorted(Comparator.comparing(PendingRegistration::getCreatedAt).reversed())
                .map(pending -> new AdminPendingRegistrationDto(
                        pending.getId(),
                        pending.getEmail(),
                        pending.getAccountName(),
                        pending.getPersonName(),
                        pending.getCreatedAt(),
                        pending.getExpiresAt(),
                        pending.getAttemptCount(),
                        pending.getResendCount()))
                .toList();
    }

    private AdminPersonDto toAdminPersonDto(Person person, Map<Long, String> emailByAccount) {
        Long accountId = person.getAccount().getId();
        return new AdminPersonDto(
                person.getId(),
                person.getName(),
                person.isPrimary(),
                accountId,
                person.getAccount().getName(),
                emailByAccount.get(accountId),
                person.getCreatedAt());
    }

    private Map<Long, Long> toLongMap(List<Object[]> rows) {
        Map<Long, Long> result = new HashMap<>();
        for (Object[] row : rows) {
            result.put((Long) row[0], (Long) row[1]);
        }
        return result;
    }

    private Map<Long, Instant> toInstantMap(List<Object[]> rows) {
        Map<Long, Instant> result = new HashMap<>();
        for (Object[] row : rows) {
            result.put((Long) row[0], (Instant) row[1]);
        }
        return result;
    }

    private Map<Long, String> toStringMap(List<Object[]> rows) {
        Map<Long, String> result = new HashMap<>();
        for (Object[] row : rows) {
            result.put((Long) row[0], (String) row[1]);
        }
        return result;
    }
}
