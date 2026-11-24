package com.worktrac.backend;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.worktrac.backend.email.EmailService;
import com.worktrac.backend.support.AbstractIntegrationTest;
import com.worktrac.backend.support.RegistrationTestSupport;
import com.worktrac.backend.user.TestCodeCache;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

// exercises.load_type (V107/V108): whether a weight is expected on a set ('external') or the
// exercise is done at bodyweight with weight added on top ('bodyweight'). It decides only how the
// Log screen asks for a person's first set; records never read it.
//
// The load-bearing cases are the lenient ones: a create is a DURABLE write replayed from the
// outbox, possibly by a client older or newer than this server, and a 400 would discard it along
// with every set queued behind its temp id. Absent and unknown both read as 'external'. Who may
// change it is pinned in MemberPermissionsTest.
@AutoConfigureMockMvc
class ExerciseLoadTypeTest extends AbstractIntegrationTest {

    @DynamicPropertySource
    static void datasource(DynamicPropertyRegistry registry) {
        registerDatasource(registry, ExerciseLoadTypeTest.class);
    }

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private TestCodeCache testCodeCache;

    @Autowired
    private JdbcTemplate jdbcTemplate;

    @MockitoBean
    private EmailService emailService;

    private final ObjectMapper objectMapper = new ObjectMapper();

    private String token;

    @BeforeEach
    void setUp() throws Exception {
        String email = "load-type-" + UUID.randomUUID().toString().substring(0, 8) + "@example.com";
        token = RegistrationTestSupport.registerAndConfirm(mockMvc, objectMapper, testCodeCache, email, "Nate")
                .get("token").asText();
    }

    private JsonNode create(String name, String loadType) throws Exception {
        Map<String, Object> body = new HashMap<>();
        body.put("name", name);
        body.put("idempotencyKey", UUID.randomUUID().toString());
        if (loadType != null) {
            body.put("loadType", loadType);
        }
        return objectMapper.readTree(mockMvc.perform(post("/api/exercises")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(body)))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString());
    }

    private JsonNode catalogRow(String name) throws Exception {
        JsonNode catalog = objectMapper.readTree(mockMvc.perform(get("/api/exercises")
                .header("Authorization", "Bearer " + token)).andReturn().getResponse().getContentAsString());
        for (JsonNode row : catalog) {
            if (row.get("name").asText().equals(name)) {
                return row;
            }
        }
        throw new AssertionError("not in the catalog: " + name);
    }

    // Every client before 1.4 sends no loadType, and so does every create one of them queued offline.
    @Test
    void aCreateWithoutALoadTypeExpectsAWeight() throws Exception {
        assertEquals("external", create("Hip Thrust Machine", null).get("loadType").asText());
    }

    @Test
    void aCreateCanBeBodyweight() throws Exception {
        assertEquals("bodyweight", create("Ring Dip", "bodyweight").get("loadType").asText());
        assertEquals("bodyweight", catalogRow("Ring Dip").get("loadType").asText());
    }

    // A newer client's value ('none', 'assisted') or a typo must never discard a durable create.
    @Test
    void anUnknownLoadTypeIsReadAsExternalNeverRefused() throws Exception {
        assertEquals("external", create("Assisted Ring Dip", "assisted").get("loadType").asText());
    }

    // A replay or a duplicate name returns the existing row untouched, like its muscles and stamp.
    @Test
    void aCreateThatResolvesToALibraryRowLeavesItsTypeAlone() throws Exception {
        assertEquals("bodyweight", create("Pull-up", "external").get("loadType").asText());
        assertEquals("external", create("Barbell Bench Press", "bodyweight").get("loadType").asText());
    }

    @Test
    void theTypeCanBeChangedLaterAndALibraryOneCannot() throws Exception {
        long id = create("Ring Dip", null).get("id").asLong();
        JsonNode updated = objectMapper.readTree(mockMvc.perform(put("/api/exercises/" + id + "/load-type")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"loadType\":\"bodyweight\"}"))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString());
        assertEquals("bodyweight", updated.get("loadType").asText());
        assertEquals("bodyweight", catalogRow("Ring Dip").get("loadType").asText());

        long pullUp = catalogRow("Pull-up").get("id").asLong();
        mockMvc.perform(put("/api/exercises/" + pullUp + "/load-type")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"loadType\":\"external\"}"))
                .andExpect(status().isForbidden());
    }

    // V108's list, as reviewed. The count is pinned so a later edit to the list is deliberate; the
    // spot checks are the cases the review turned on (a weighted variant, a carry, an assisted
    // machine are all 'external').
    @Test
    void theLibraryIsClassifiedAsReviewed() throws Exception {
        Integer bodyweight = jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM exercises WHERE account_id IS NULL AND load_type = 'bodyweight'", Integer.class);
        assertEquals(62, bodyweight);
        assertEquals("bodyweight", catalogRow("Pull-up").get("loadType").asText());
        assertEquals("bodyweight", catalogRow("Plank").get("loadType").asText());
        assertEquals("external", catalogRow("Barbell Bench Press").get("loadType").asText());
        assertEquals("external", catalogRow("Weighted Sit-up").get("loadType").asText());
        assertEquals("external", catalogRow("Farmer's Carry").get("loadType").asText());
        assertEquals("external", catalogRow("Assisted Pull-up Machine").get("loadType").asText());
    }
}
