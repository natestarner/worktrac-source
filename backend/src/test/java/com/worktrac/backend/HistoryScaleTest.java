package com.worktrac.backend;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.worktrac.backend.email.EmailService;
import com.worktrac.backend.exercise.Exercise;
import com.worktrac.backend.exercise.ExerciseRepository;
import com.worktrac.backend.person.Person;
import com.worktrac.backend.person.PersonRepository;
import com.worktrac.backend.sessionexercisenote.SessionExerciseNote;
import com.worktrac.backend.sessionexercisenote.SessionExerciseNoteRepository;
import com.worktrac.backend.support.AbstractIntegrationTest;
import com.worktrac.backend.support.RegistrationTestSupport;
import com.worktrac.backend.user.TestCodeCache;
import com.worktrac.backend.workoutsession.WorkoutSession;
import com.worktrac.backend.workoutsession.WorkoutSessionRepository;
import com.worktrac.backend.workoutset.WorkoutSet;
import com.worktrac.backend.workoutset.WorkoutSetRepository;
import jakarta.persistence.EntityManagerFactory;
import org.hibernate.SessionFactory;
import org.hibernate.stat.Statistics;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestInstance;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.math.BigDecimal;
import java.time.Duration;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Map;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

// A person with years of daily history, which is the one shape no other test here has -- every
// other class seeds a handful of sessions, so both of these regressions passed everything:
//
//   1. SQL Server rejects a statement with more than 2,100 parameters. History and CSV export used
//      to fetch notes with `session_id IN (?, ?, ...)`, one parameter per session, so both failed
//      outright (503) once a person passed ~2,100 sessions -- about 5.75 years of daily training.
//   2. The whole-history reads (/prs, trends, records, the Log screen's summary) loaded every set
//      without its session and then read each set's session start time, one lazy SELECT per
//      session -- ~2,000 statements per request at 2,000 sessions.
//
// Sessions are seeded through the repositories rather than the API: 2,150 POSTs would dominate the
// suite's runtime for no extra coverage. They are spaced 30 minutes apart so all of them fall well
// inside the Free-tier history window -- History must return every one, not just survive.
@AutoConfigureMockMvc
// PER_CLASS so the 2,150 sessions are seeded once for the class, not once per test method.
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class HistoryScaleTest extends AbstractIntegrationTest {

    private static final int SESSION_COUNT = 2_150;

    // Comfortably above the few statements a request needs (auth, person guard, the loads), and two
    // orders of magnitude below SESSION_COUNT -- so a per-session query cannot hide under it.
    private static final long MAX_STATEMENTS_PER_REQUEST = 25;

    @DynamicPropertySource
    static void datasource(DynamicPropertyRegistry registry) {
        registerDatasource(registry, HistoryScaleTest.class);
        registry.add("spring.jpa.properties.hibernate.generate_statistics", () -> "true");
    }

    @Autowired private MockMvc mockMvc;
    @Autowired private TestCodeCache testCodeCache;
    @Autowired private PersonRepository personRepository;
    @Autowired private ExerciseRepository exerciseRepository;
    @Autowired private WorkoutSessionRepository workoutSessionRepository;
    @Autowired private WorkoutSetRepository workoutSetRepository;
    @Autowired private SessionExerciseNoteRepository sessionExerciseNoteRepository;
    @Autowired private EntityManagerFactory entityManagerFactory;
    @Autowired private PlatformTransactionManager transactionManager;

    @MockitoBean private EmailService emailService;

    private final ObjectMapper objectMapper = new ObjectMapper();

    private String token;
    private long personId;
    private long otherPersonId;
    private long exerciseId;

    @BeforeAll
    void setUp() throws Exception {
        String email = "scale-" + UUID.randomUUID().toString().substring(0, 8) + "@example.com";
        JsonNode registration = RegistrationTestSupport.registerAndConfirm(
                mockMvc, objectMapper, testCodeCache, email, "Nate");
        token = registration.get("token").asText();
        personId = registration.get("person").get("id").asLong();
        otherPersonId = objectMapper.readTree(mockMvc.perform(post("/api/people")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of("name", "Sam"))))
                .andReturn().getResponse().getContentAsString()).get("id").asLong();

        String exercises = mockMvc.perform(get("/api/exercises").header("Authorization", "Bearer " + token))
                .andReturn().getResponse().getContentAsString();
        exerciseId = objectMapper.readTree(exercises).get(0).get("id").asLong();

        Instant newest = Instant.now().minus(1, ChronoUnit.HOURS).truncatedTo(ChronoUnit.SECONDS);
        new TransactionTemplate(transactionManager).executeWithoutResult(tx -> {
            Person person = personRepository.findById(personId).orElseThrow();
            Person other = personRepository.findById(otherPersonId).orElseThrow();
            Exercise exercise = exerciseRepository.findById(exerciseId).orElseThrow();
            for (int i = 0; i < SESSION_COUNT; i++) {
                Instant startedAt = newest.minus(Duration.ofMinutes(30L * (SESSION_COUNT - 1 - i)));
                WorkoutSession session = seedSession(person, exercise, startedAt, new BigDecimal(100 + i % 50));
                // The oldest and the newest session each carry a note: the lookup must reach both
                // ends of the history, not only the part that used to fit under the parameter cap.
                if (i == 0) sessionExerciseNoteRepository.save(new SessionExerciseNote(session, exercise, "oldest note"));
                if (i == SESSION_COUNT - 1) sessionExerciseNoteRepository.save(new SessionExerciseNote(session, exercise, "newest note"));
            }
            // Another person in the same household, with a note of their own. Notes are now looked
            // up by person rather than by an explicit list of session ids, so this is the row that
            // would leak if that scoping were wrong.
            WorkoutSession otherSession = seedSession(other, exercise, newest, new BigDecimal("95.00"));
            sessionExerciseNoteRepository.save(new SessionExerciseNote(otherSession, exercise, "someone else's note"));
        });
    }

    private WorkoutSession seedSession(Person person, Exercise exercise, Instant startedAt, BigDecimal weight) {
        WorkoutSession session = new WorkoutSession(person, startedAt, true);
        session.setEndedAt(startedAt.plus(Duration.ofMinutes(20)));
        workoutSessionRepository.save(session);
        workoutSetRepository.save(new WorkoutSet(session, person, exercise, weight, 8, "lb",
                null, startedAt.plus(Duration.ofMinutes(5)), null));
        return session;
    }

    @Test
    void historyReturnsEverySessionAndItsNotesPastTheSqlServerParameterCap() throws Exception {
        JsonNode history = objectMapper.readTree(perform("/api/people/" + personId + "/history").getResponse().getContentAsString());

        assertEquals(SESSION_COUNT, history.size());
        // startedAt DESC: the newest session first, the oldest last.
        assertEquals("newest note", history.get(0).get("entries").get(0).get("note").asText());
        assertEquals("oldest note", history.get(SESSION_COUNT - 1).get("entries").get(0).get("note").asText());
        assertFalse(history.toString().contains("someone else's note"));
    }

    // The sync at the same scale: a first sync carries every session (and both ends' notes), and
    // sending back what it returned gets nothing -- the months are identified by fingerprint, not by
    // binding a list of session ids, so no parameter cap can be reached as history grows.
    @Test
    void historySyncCarriesEverySessionAndThenNothingPastTheSqlServerParameterCap() throws Exception {
        JsonNode first = sync("{\"have\":{}}");
        int sessions = 0;
        Map<String, String> have = new java.util.LinkedHashMap<>();
        for (JsonNode month : first.get("months")) {
            JsonNode content = first.get("changed").get(month.asText());
            sessions += content.get("sessions").size();
            have.put(month.asText(), content.get("fp").asText());
        }
        assertEquals(SESSION_COUNT, sessions);
        assertTrue(first.toString().contains("oldest note"));
        assertTrue(first.toString().contains("newest note"));
        assertFalse(first.toString().contains("someone else's note"));

        JsonNode second = sync(objectMapper.writeValueAsString(Map.of("have", have)));
        assertTrue(second.get("changed").isEmpty());
        assertEquals(first.get("months"), second.get("months"));
    }

    private JsonNode sync(String body) throws Exception {
        MvcResult result = mockMvc.perform(post("/api/people/" + personId + "/history/sync")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andReturn();
        assertEquals(200, result.getResponse().getStatus(), "sync -> " + result.getResolvedException());
        return objectMapper.readTree(result.getResponse().getContentAsString());
    }

    @Test
    void csvExportIncludesNotesPastTheSqlServerParameterCap() throws Exception {
        String csv = perform("/api/people/" + personId + "/export.csv").getResponse().getContentAsString();

        assertTrue(csv.contains("oldest note"));
        assertTrue(csv.contains("newest note"));
        assertFalse(csv.contains("someone else's note"));
    }

    @Test
    void wholeHistoryReadsDoNotIssueAQueryPerSession() throws Exception {
        String person = "/api/people/" + personId;
        for (String url : new String[] {
                person + "/history",
                person + "/export.csv",
                person + "/prs",
                person + "/trends/overview?weeks=12",
                person + "/trends/exercises/" + exerciseId + "?weeks=12",
                person + "/exercises/" + exerciseId + "/records",
                person + "/exercises/" + exerciseId + "/summary",
        }) {
            long statements = statementsFor(url);
            assertTrue(statements <= MAX_STATEMENTS_PER_REQUEST,
                    url + " prepared " + statements + " statements for " + SESSION_COUNT + " sessions");
        }
    }

    private long statementsFor(String url) throws Exception {
        Statistics statistics = entityManagerFactory.unwrap(SessionFactory.class).getStatistics();
        statistics.clear();
        perform(url);
        return statistics.getPrepareStatementCount();
    }

    private MvcResult perform(String url) throws Exception {
        MvcResult result = mockMvc.perform(get(url).header("Authorization", "Bearer " + token)).andReturn();
        assertEquals(200, result.getResponse().getStatus(),
                url + " -> " + result.getResponse().getStatus() + " " + result.getResolvedException());
        return result;
    }
}
