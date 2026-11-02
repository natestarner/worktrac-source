package com.worktrac.backend.workoutset;

import com.worktrac.backend.account.Account;
import com.worktrac.backend.account.AccountRepository;
import com.worktrac.backend.email.EmailService;
import com.worktrac.backend.exercise.Exercise;
import com.worktrac.backend.exercise.ExerciseRepository;
import com.worktrac.backend.membership.AccountAccess;
import com.worktrac.backend.person.Person;
import com.worktrac.backend.person.PersonRepository;
import com.worktrac.backend.support.AbstractIntegrationTest;
import com.worktrac.backend.workoutsession.WorkoutSessionService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;

// The same set saved twice at the same moment -- a lie-fi request the client gave up on while the
// server was still working, then retried -- both pass the "already saved?" check, and the second
// insert hits UX_workout_sets_client_key. That used to surface as a 503 ("having trouble reaching
// your data"), which the outbox retried until the dedup answered. The write was never lost, but
// the 503 was a lie: the set WAS saved. Every concurrent copy must now answer with the one set.
class SetReplayConcurrencyTest extends AbstractIntegrationTest {

    private static final int COPIES = 8;

    @DynamicPropertySource
    static void datasource(DynamicPropertyRegistry registry) {
        registerDatasource(registry, SetReplayConcurrencyTest.class);
    }

    @MockitoBean
    private EmailService emailService;

    @Autowired
    private WorkoutSetService sets;

    @Autowired
    private WorkoutSessionService sessions;

    @Autowired
    private AccountRepository accountRepository;

    @Autowired
    private PersonRepository personRepository;

    @Autowired
    private ExerciseRepository exerciseRepository;

    @Autowired
    private JdbcTemplate jdbc;

    private record Household(AccountAccess access, Person person, Exercise exercise) {
    }

    private Household newHousehold() {
        Account account = accountRepository.save(new Account("Household " + UUID.randomUUID().toString().substring(0, 8)));
        Person person = personRepository.save(new Person(account, "Sam", false));
        Exercise exercise = exerciseRepository.save(new Exercise(account, "Bench Press", null));
        return new Household(AccountAccess.ownerOf(1L, account.getId()), person, exercise);
    }

    private Set<Long> runConcurrently(Callable<LogSetResultDto> save) throws Exception {
        ExecutorService pool = Executors.newFixedThreadPool(COPIES);
        CountDownLatch start = new CountDownLatch(1);
        try {
            List<Future<Long>> results = new ArrayList<>();
            for (int i = 0; i < COPIES; i++) {
                results.add(pool.submit(() -> {
                    start.await();
                    return save.call().set().id();
                }));
            }
            start.countDown();
            Set<Long> ids = new HashSet<>();
            for (Future<Long> result : results) {
                ids.add(result.get(60, TimeUnit.SECONDS));
            }
            return ids;
        } finally {
            pool.shutdownNow();
        }
    }

    private int rowsWithKey(String key) {
        return jdbc.queryForObject("SELECT COUNT(*) FROM workout_sets WHERE client_key = ?", Integer.class, key);
    }

    @Test
    void concurrentCopiesOfOneLiveSetAllAnswerWithTheSameSet() throws Exception {
        Household h = newHousehold();
        String key = UUID.randomUUID().toString();
        LogSetRequest request = new LogSetRequest(h.exercise().getId(), new BigDecimal("135"), 5, key, null);

        Set<Long> ids = runConcurrently(() -> sets.logLiveSet(h.access(), h.person().getId(), request));

        assertThat(ids).as("every copy must succeed and name the one stored set").hasSize(1);
        assertThat(rowsWithKey(key)).isEqualTo(1);
    }

    @Test
    void concurrentCopiesOfOneSetIntoAnExplicitSessionAllAnswerWithTheSameSet() throws Exception {
        Household h = newHousehold();
        Long sessionId = sessions.getOrCreateLiveSession(h.person()).getId();
        String key = UUID.randomUUID().toString();
        LogSetRequest request = new LogSetRequest(h.exercise().getId(), new BigDecimal("95"), 8, key, null);

        Set<Long> ids = runConcurrently(() -> sets.logSetIntoSession(h.access(), sessionId, request));

        assertThat(ids).as("every copy must succeed and name the one stored set").hasSize(1);
        assertThat(rowsWithKey(key)).isEqualTo(1);
    }
}
