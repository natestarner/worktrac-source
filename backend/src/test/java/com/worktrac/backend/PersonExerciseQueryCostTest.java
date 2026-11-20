package com.worktrac.backend;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.worktrac.backend.email.EmailService;
import com.worktrac.backend.exercise.Exercise;
import com.worktrac.backend.exercise.ExerciseRepository;
import com.worktrac.backend.exercise.PersonExercise;
import com.worktrac.backend.exercise.PersonExerciseField;
import com.worktrac.backend.exercise.PersonExerciseFieldRepository;
import com.worktrac.backend.exercise.PersonExerciseRepository;
import com.worktrac.backend.person.Person;
import com.worktrac.backend.person.PersonRepository;
import com.worktrac.backend.support.AbstractIntegrationTest;
import com.worktrac.backend.support.RegistrationTestSupport;
import com.worktrac.backend.tag.Tag;
import com.worktrac.backend.tag.TagRepository;
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
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

// The Log picker list (GET /people/{id}/exercises) and CSV export must cost the same number of
// statements however many exercises a person has personalized. Both read each PersonExercise's tags
// and custom fields, which are lazy collections, so a plain load was one SELECT per exercise for
// tags plus one per exercise for custom fields. In production the database is in another Azure
// region from the app (docs/azure-read-only-access.md), so every one of those is a cross-region
// round trip: 52 tag lookups in one app open on 2026-11-20.
//
// Two people in one household, one with FEW personalized exercises and one with MANY. Every
// personalized exercise carries a tag and a custom field, and a logged set so export has a row for
// it. The statement counts for the two must be equal: anything per exercise shows up as a difference.
@AutoConfigureMockMvc
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class PersonExerciseQueryCostTest extends AbstractIntegrationTest {

    private static final int FEW = 2;
    private static final int MANY = 12;

    @DynamicPropertySource
    static void datasource(DynamicPropertyRegistry registry) {
        registerDatasource(registry, PersonExerciseQueryCostTest.class);
        registry.add("spring.jpa.properties.hibernate.generate_statistics", () -> "true");
    }

    @Autowired private MockMvc mockMvc;
    @Autowired private TestCodeCache testCodeCache;
    @Autowired private PersonRepository personRepository;
    @Autowired private ExerciseRepository exerciseRepository;
    @Autowired private PersonExerciseRepository personExerciseRepository;
    @Autowired private PersonExerciseFieldRepository personExerciseFieldRepository;
    @Autowired private TagRepository tagRepository;
    @Autowired private WorkoutSessionRepository workoutSessionRepository;
    @Autowired private WorkoutSetRepository workoutSetRepository;
    @Autowired private EntityManagerFactory entityManagerFactory;
    @Autowired private PlatformTransactionManager transactionManager;

    @MockitoBean private EmailService emailService;

    private final ObjectMapper objectMapper = new ObjectMapper();

    private String token;
    private long fewPersonId;
    private long manyPersonId;

    @BeforeAll
    void setUp() throws Exception {
        String email = "pe-cost-" + UUID.randomUUID().toString().substring(0, 8) + "@example.com";
        JsonNode registration = RegistrationTestSupport.registerAndConfirm(
                mockMvc, objectMapper, testCodeCache, email, "Nate");
        token = registration.get("token").asText();
        fewPersonId = registration.get("person").get("id").asLong();
        manyPersonId = objectMapper.readTree(mockMvc.perform(post("/api/people")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of("name", "Sam"))))
                .andReturn().getResponse().getContentAsString()).get("id").asLong();

        new TransactionTemplate(transactionManager).executeWithoutResult(tx -> {
            seed(personRepository.findById(fewPersonId).orElseThrow(), FEW);
            seed(personRepository.findById(manyPersonId).orElseThrow(), MANY);
        });
    }

    private void seed(Person person, int count) {
        Instant startedAt = Instant.now().minus(1, ChronoUnit.HOURS).truncatedTo(ChronoUnit.SECONDS);
        WorkoutSession session = new WorkoutSession(person, startedAt, true);
        session.setEndedAt(startedAt.plus(Duration.ofMinutes(30)));
        workoutSessionRepository.save(session);
        for (int i = 0; i < count; i++) {
            String name = person.getName() + " lift " + i;
            Exercise exercise = exerciseRepository.save(new Exercise(person.getAccount(), name));
            Tag tag = tagRepository.save(new Tag(person.getAccount(), name + " tag", null));
            PersonExercise pe = new PersonExercise(person, exercise);
            pe.getTags().add(tag);
            pe = personExerciseRepository.save(pe);
            personExerciseFieldRepository.save(new PersonExerciseField(pe, "Seat", 0));
            workoutSetRepository.save(new WorkoutSet(session, person, exercise, new BigDecimal("100.00"), 8,
                    "lb", null, startedAt.plus(Duration.ofMinutes(i)), null));
        }
    }

    @Test
    void thePickerListCostsTheSameForFewAndManyExercises() throws Exception {
        JsonNode many = objectMapper.readTree(perform("/api/people/" + manyPersonId + "/exercises")
                .getResponse().getContentAsString());
        // The seeded rows really are personalized: each comes back with its tag.
        assertEquals(MANY, many.size());
        for (JsonNode row : many) {
            assertEquals(1, row.get("tags").size(), row.toString());
        }

        long few = statementsFor("/api/people/" + fewPersonId + "/exercises");
        long manyStatements = statementsFor("/api/people/" + manyPersonId + "/exercises");
        assertEquals(few, manyStatements, "picker list: " + FEW + " exercises prepared " + few
                + " statements, " + MANY + " prepared " + manyStatements);
    }

    @Test
    void csvExportCostsTheSameForFewAndManyExercises() throws Exception {
        String csv = perform("/api/people/" + manyPersonId + "/export.csv").getResponse().getContentAsString();
        // Tags and custom fields still reach the export.
        assertTrue(csv.contains("Sam lift 11 tag"), csv);
        assertTrue(csv.contains("Seat"), csv);

        long few = statementsFor("/api/people/" + fewPersonId + "/export.csv");
        long manyStatements = statementsFor("/api/people/" + manyPersonId + "/export.csv");
        assertEquals(few, manyStatements, "export: " + FEW + " exercises prepared " + few
                + " statements, " + MANY + " prepared " + manyStatements);
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
