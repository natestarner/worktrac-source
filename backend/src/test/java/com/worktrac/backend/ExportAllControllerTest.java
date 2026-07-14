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

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

// The "export all data" account-wide download: one CSV per person on the account, zipped
// together (see export/CsvExportService#exportAll and ExportController#exportAll), wired up
// from AppSettingsTab.jsx rather than the per-person History tab export CsvExportControllerTest
// already covers.
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("local")
@Testcontainers
class ExportAllControllerTest {

    @Container
    @ServiceConnection
    static MSSQLServerContainer<?> sqlServer = new MSSQLServerContainer<>("mcr.microsoft.com/mssql/server:2022-latest")
            .acceptLicense();

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private TestCodeCache testCodeCache;

    @MockitoBean
    private EmailService emailService;

    private final ObjectMapper objectMapper = new ObjectMapper();

    private String token;
    private long primaryPersonId;

    @BeforeEach
    void setUp() throws Exception {
        String email = "export-all-" + UUID.randomUUID().toString().substring(0, 8) + "@example.com";
        JsonNode registerJson = RegistrationTestSupport.registerAndConfirm(mockMvc, objectMapper, testCodeCache, email, "Nate");
        token = registerJson.get("token").asText();
        primaryPersonId = registerJson.get("person").get("id").asLong();
    }

    private long addPerson(String name) throws Exception {
        String body = objectMapper.writeValueAsString(Map.of("name", name));
        String response = mockMvc.perform(post("/api/people")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        return objectMapper.readTree(response).get("id").asLong();
    }

    private long createExercise(String name, long categoryId) throws Exception {
        String body = objectMapper.writeValueAsString(Map.of(
                "name", name, "categoryId", categoryId, "setupFieldNames", java.util.List.of()));
        String response = mockMvc.perform(post("/api/exercises")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        return objectMapper.readTree(response).get("id").asLong();
    }

    private void logLiveSet(long personId, long exerciseId, double weight, int reps) throws Exception {
        String body = objectMapper.writeValueAsString(Map.of("exerciseId", exerciseId, "weight", weight, "reps", reps));
        mockMvc.perform(post("/api/people/" + personId + "/live-sets")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isOk());
    }

    private long globalCategoryId() throws Exception {
        String response = mockMvc.perform(get("/api/categories").header("Authorization", "Bearer " + token))
                .andReturn().getResponse().getContentAsString();
        return objectMapper.readTree(response).get(0).get("id").asLong();
    }

    @Test
    void zipsOnePerPersonCsvForEveryPersonOnTheAccount() throws Exception {
        long category = globalCategoryId();
        long exercise = createExercise("Bench Press", category);

        long secondPersonId = addPerson("Jax");

        logLiveSet(primaryPersonId, exercise, 135, 8);
        logLiveSet(secondPersonId, exercise, 45, 12);

        byte[] zipBytes = mockMvc.perform(get("/api/export/all.zip").header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsByteArray();

        Map<String, String> entries = unzip(zipBytes);
        assertEquals(2, entries.size(), "one CSV entry per person on the account");

        boolean sawNate = false;
        boolean sawJax = false;
        for (Map.Entry<String, String> entry : entries.entrySet()) {
            if (entry.getKey().startsWith("Nate-workout-data-")) {
                sawNate = true;
                assertTrue(entry.getValue().contains("Bench Press"), "Nate's CSV should contain his logged set");
                assertTrue(entry.getValue().contains("135.00"));
            } else if (entry.getKey().startsWith("Jax-workout-data-")) {
                sawJax = true;
                assertTrue(entry.getValue().contains("Bench Press"), "Jax's CSV should contain his logged set");
                assertTrue(entry.getValue().contains("45.00"));
            }
        }
        assertTrue(sawNate, "expected an entry for Nate");
        assertTrue(sawJax, "expected an entry for Jax");
    }

    @Test
    void disambiguatesZipEntriesWhenTwoPeopleShareADisplayName() throws Exception {
        long secondPersonId = addPerson("Temp");
        mockMvc.perform(patch("/api/people/" + secondPersonId)
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of("name", "Nate"))))
                .andExpect(status().isOk());

        byte[] zipBytes = mockMvc.perform(get("/api/export/all.zip").header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsByteArray();

        Map<String, String> entries = unzip(zipBytes);
        assertEquals(2, entries.size(), "both same-named people should get their own zip entry, not overwrite each other");
        long distinctPrefixed = entries.keySet().stream().filter(name -> name.contains("-" + secondPersonId + ".csv")).count();
        assertEquals(1, distinctPrefixed, "the colliding entry should be disambiguated with the person's id");
    }

    private Map<String, String> unzip(byte[] zipBytes) throws Exception {
        Map<String, String> entries = new HashMap<>();
        try (ZipInputStream zip = new ZipInputStream(new ByteArrayInputStream(zipBytes))) {
            ZipEntry entry;
            while ((entry = zip.getNextEntry()) != null) {
                ByteArrayOutputStream content = new ByteArrayOutputStream();
                zip.transferTo(content);
                entries.put(entry.getName(), content.toString("UTF-8"));
            }
        }
        return entries;
    }
}
