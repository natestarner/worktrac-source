package com.worktrac.backend.workoutsession;

import com.worktrac.backend.account.Account;
import com.worktrac.backend.account.AccountRepository;
import com.worktrac.backend.email.EmailService;
import com.worktrac.backend.person.Person;
import com.worktrac.backend.person.PersonRepository;
import com.worktrac.backend.support.AbstractIntegrationTest;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;

// One person has at most one live workout. getOrCreateLiveSession decides that by "find one, else
// create one", so concurrent first sets -- two replicas, two family devices, an offline queue
// draining while another set is logged -- used to both find none and both create one.
class LiveSessionConcurrencyTest extends AbstractIntegrationTest {

    @DynamicPropertySource
    static void datasource(DynamicPropertyRegistry registry) {
        registerDatasource(registry, LiveSessionConcurrencyTest.class);
    }

    @MockitoBean
    private EmailService emailService;

    @Autowired
    private WorkoutSessionService sessions;

    @Autowired
    private AccountRepository accountRepository;

    @Autowired
    private PersonRepository personRepository;

    @Autowired
    private JdbcTemplate jdbc;

    private Person newPerson(String name) {
        Account account = accountRepository.save(new Account("Household " + UUID.randomUUID().toString().substring(0, 8)));
        return personRepository.save(new Person(account, name, false));
    }

    private Set<Long> startConcurrently(List<Person> people, int perPerson) throws Exception {
        int total = people.size() * perPerson;
        ExecutorService pool = Executors.newFixedThreadPool(total);
        CountDownLatch start = new CountDownLatch(1);
        try {
            List<Future<Long>> results = new ArrayList<>();
            for (Person person : people) {
                for (int i = 0; i < perPerson; i++) {
                    results.add(pool.submit(() -> {
                        start.await();
                        return sessions.getOrCreateLiveSession(person).getId();
                    }));
                }
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

    private int openSessions(Person person) {
        return jdbc.queryForObject(
                "SELECT COUNT(*) FROM workout_sessions WHERE person_id = ? AND ended_at IS NULL", Integer.class,
                person.getId());
    }

    @Test
    void concurrentFirstSetsShareOneLiveSession() throws Exception {
        Person person = newPerson("Sam");

        Set<Long> ids = startConcurrently(List.of(person), 12);

        assertThat(ids).as("every concurrent first set must land in the same live session").hasSize(1);
        assertThat(openSessions(person)).isEqualTo(1);
    }

    @Test
    void differentPeopleStillGetTheirOwnSessions() throws Exception {
        Person sam = newPerson("Sam");
        Person kit = newPerson("Kit");

        Set<Long> ids = startConcurrently(List.of(sam, kit), 6);

        assertThat(ids).hasSize(2);
        assertThat(openSessions(sam)).isEqualTo(1);
        assertThat(openSessions(kit)).isEqualTo(1);
    }
}
