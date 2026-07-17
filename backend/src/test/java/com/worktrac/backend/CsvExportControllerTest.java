package com.worktrac.backend;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.worktrac.backend.email.EmailService;
import com.worktrac.backend.support.RegistrationTestSupport;
import com.worktrac.backend.user.TestCodeCache;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.testcontainers.containers.MSSQLServerContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

// Multi-row / multi-session / multi-exercise CSV export correctness -- the existing
// WorkoutFlowTest CSV coverage only ever checks the header and a single data row.
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("local")
@Testcontainers
class CsvExportControllerTest {

    @Container
    @ServiceConnection
    static MSSQLServerContainer<?> sqlServer = new MSSQLServerContainer<>("mcr.microsoft.com/mssql/server:2022-latest")
            .acceptLicense();

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private TestCodeCache testCodeCache;

    // EmailService's real constructor builds a live Azure EmailClient from
    // app.email.connection-string, which is empty in the "local" test profile (no real ACS
    // resource in CI) -- @MockitoBean replaces the bean entirely so that constructor never runs.
    @MockitoBean
    private EmailService emailService;

    private final ObjectMapper objectMapper = new ObjectMapper();

    private String token;
    private long personId;

    @BeforeEach
    void setUp() throws Exception {
        String email = "csv-" + UUID.randomUUID().toString().substring(0, 8) + "@example.com";
        JsonNode registerJson = RegistrationTestSupport.registerAndConfirm(mockMvc, objectMapper, testCodeCache, email, "Nate");
        token = registerJson.get("token").asText();
        personId = registerJson.get("person").get("id").asLong();
    }

    private long logLiveSet(long exerciseId, double weight, int reps) throws Exception {
        String body = objectMapper.writeValueAsString(Map.of("exerciseId", exerciseId, "weight", weight, "reps", reps));
        String response = mockMvc.perform(post("/api/people/" + personId + "/live-sets")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        return objectMapper.readTree(response).get("session").get("id").asLong();
    }

    @Test
    void exportsMultipleSessionsAndExercisesWithCorrectSetNumberingAndEscaping() throws Exception {
        // A category name containing a comma, to exercise CSV quote-escaping.
        String categoryBody = objectMapper.writeValueAsString(Map.of("name", "Full Body, Conditioning"));
        String categoryResponse = mockMvc.perform(post("/api/categories")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(categoryBody))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        long commaCategory = objectMapper.readTree(categoryResponse).get("id").asLong();

        String globalCategoriesResponse = mockMvc.perform(get("/api/categories").header("Authorization", "Bearer " + token))
                .andReturn().getResponse().getContentAsString();
        long globalCategory = objectMapper.readTree(globalCategoriesResponse).get(0).get("id").asLong();

        long exerciseA = createExercise("Exercise A", commaCategory);
        long exerciseB = createExercise("Exercise B", globalCategory);

        // Session 1: two sets of Exercise A, one set of Exercise B, then explicitly ended.
        logLiveSet(exerciseA, 135, 8);
        logLiveSet(exerciseA, 140, 8);
        logLiveSet(exerciseB, 95, 10);
        mockMvc.perform(post("/api/people/" + personId + "/sessions/live/end").header("Authorization", "Bearer " + token))
                .andExpect(status().isNoContent());

        // Session 2 (a fresh live session): one more set of Exercise A -- Set # must
        // reset back to 1 here, not continue from session 1's count of 2.
        logLiveSet(exerciseA, 150, 5);

        String csvResponse = mockMvc.perform(get("/api/people/" + personId + "/export.csv")
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        String[] lines = csvResponse.split("\n");

        assertEquals("Date,Time,Exercise,Category,Set #,Weight,Unit,Reps,Est. 1RM", lines[0]);
        assertEquals(5, lines.length, "header + 4 set rows (2 for A in session 1, 1 for B in session 1, 1 for A in session 2)");

        // Sessions ordered oldest-first: session 1's three rows, then session 2's row.
        String[] row1 = splitCsvLine(lines[1]);
        assertEquals("Exercise A", row1[2]);
        assertEquals("Full Body, Conditioning", row1[3], "comma-containing category name should round-trip through quote-escaping");
        assertEquals("1", row1[4], "first set of Exercise A in session 1 is Set # 1");
        assertEquals("135.00", row1[5]);
        assertEquals("lb", row1[6]);
        assertEquals("8", row1[7]);

        String[] row2 = splitCsvLine(lines[2]);
        assertEquals("Exercise A", row2[2]);
        assertEquals("2", row2[4], "second set of Exercise A in session 1 is Set # 2");

        String[] row3 = splitCsvLine(lines[3]);
        assertEquals("Exercise B", row3[2]);
        assertEquals("1", row3[4], "Exercise B's only set in session 1 is Set # 1");

        String[] row4 = splitCsvLine(lines[4]);
        assertEquals("Exercise A", row4[2]);
        assertEquals("1", row4[4], "Exercise A's set in session 2 resets back to Set # 1, not continuing session 1's count");
    }

    // Minimal quote-aware CSV field splitter matching CsvExportService's own escaping
    // (fields containing a comma/quote/newline are wrapped in double quotes, with
    // embedded quotes doubled) -- enough to unpick a single data row for assertions.
    private String[] splitCsvLine(String line) {
        List<String> fields = new java.util.ArrayList<>();
        StringBuilder current = new StringBuilder();
        boolean inQuotes = false;
        for (int i = 0; i < line.length(); i++) {
            char c = line.charAt(i);
            if (inQuotes) {
                if (c == '"' && i + 1 < line.length() && line.charAt(i + 1) == '"') {
                    current.append('"');
                    i++;
                } else if (c == '"') {
                    inQuotes = false;
                } else {
                    current.append(c);
                }
            } else if (c == '"') {
                inQuotes = true;
            } else if (c == ',') {
                fields.add(current.toString());
                current.setLength(0);
            } else {
                current.append(c);
            }
        }
        fields.add(current.toString());
        return fields.toArray(new String[0]);
    }

    private long createExercise(String name, long categoryId) throws Exception {
        String body = objectMapper.writeValueAsString(Map.of(
                "name", name, "categoryId", categoryId));
        String response = mockMvc.perform(post("/api/exercises")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        return objectMapper.readTree(response).get("id").asLong();
    }
}
