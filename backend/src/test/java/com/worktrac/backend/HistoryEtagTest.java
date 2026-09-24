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
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.UUID;
import java.util.zip.GZIPInputStream;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

// History's ETag (HistoryEtagConfig) and response compression (server.compression), against a REAL
// Tomcat -- compression happens in the connector, which MockMvc never runs, and it is the layer
// most likely to disturb an ETag on its way out. MockMvc is used only to seed data.
//
// The guarantee that matters: a 304 is sent only when History is exactly what the client already
// has. Every "changed" case below asserts the stale tag gets a full 200 with the new content.
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@AutoConfigureMockMvc
class HistoryEtagTest extends AbstractIntegrationTest {

    @DynamicPropertySource
    static void datasource(DynamicPropertyRegistry registry) {
        registerDatasource(registry, HistoryEtagTest.class);
    }

    @LocalServerPort private int port;
    @Autowired private MockMvc mockMvc;
    @Autowired private TestCodeCache testCodeCache;
    @MockitoBean private EmailService emailService;

    private final ObjectMapper objectMapper = new ObjectMapper();
    private final HttpClient http = HttpClient.newHttpClient();

    private String token;
    private long personId;
    private long exerciseId;
    private long sessionId;

    @BeforeEach
    void setUp() throws Exception {
        String email = "etag-" + UUID.randomUUID().toString().substring(0, 8) + "@example.com";
        JsonNode registration = RegistrationTestSupport.registerAndConfirm(
                mockMvc, objectMapper, testCodeCache, email, "Nate");
        token = registration.get("token").asText();
        personId = registration.get("person").get("id").asLong();
        String exercises = mockMvc.perform(get("/api/exercises").header("Authorization", "Bearer " + token))
                .andReturn().getResponse().getContentAsString();
        exerciseId = objectMapper.readTree(exercises).get(0).get("id").asLong();
        sessionId = createPastSession(personId, "2026-09-01T12:00:00Z");
        logSet(sessionId, 135, 8);
    }

    // ---- ETag / 304 -------------------------------------------------------------------------

    @Test
    void anUnchangedHistoryAnswers304WithNoBody() throws Exception {
        HttpResponse<byte[]> first = history(personId, null, false);
        String etag = first.headers().firstValue("ETag").orElse(null);
        assertEquals(200, first.statusCode());
        assertNotNull(etag, "history must carry an ETag");

        HttpResponse<byte[]> second = history(personId, etag, false);
        assertEquals(304, second.statusCode());
        assertEquals(0, second.body().length);
    }

    @Test
    void aNewSetInvalidatesTheTag() throws Exception {
        String etag = confirmedCurrentTag();
        logSet(sessionId, 155, 3);
        assertChangedTo(etag, "155");
    }

    @Test
    void aNewSessionNoteInvalidatesTheTag() throws Exception {
        String etag = confirmedCurrentTag();
        mockMvc.perform(put("/api/sessions/" + sessionId + "/exercises/" + exerciseId + "/note")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of("note", "grip slipped on rep 6"))))
                .andExpect(status().isOk());
        assertChangedTo(etag, "grip slipped on rep 6");
    }

    @Test
    void aNewSessionInvalidatesTheTag() throws Exception {
        String etag = confirmedCurrentTag();
        logSet(createPastSession(personId, "2026-09-03T12:00:00Z"), 95, 12);
        assertChangedTo(etag, "2026-09-03T12:00:00Z");
    }

    @Test
    void aTagFromAnotherPersonsHistoryNeverMatches() throws Exception {
        long otherPersonId = objectMapper.readTree(mockMvc.perform(post("/api/people")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of("name", "Sam"))))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString()).get("id").asLong();
        logSet(createPastSession(otherPersonId, "2026-09-02T12:00:00Z"), 50, 10);

        String othersTag = history(otherPersonId, null, false).headers().firstValue("ETag").orElseThrow();
        HttpResponse<byte[]> mine = history(personId, othersTag, false);
        assertEquals(200, mine.statusCode());
        assertFalse(new String(mine.body(), StandardCharsets.UTF_8).contains("\"weight\":50"));
    }

    @Test
    void onlyHistoryIsTagged() throws Exception {
        HttpResponse<byte[]> prs = send("/api/people/" + personId + "/prs", null, false);
        assertEquals(200, prs.statusCode());
        assertTrue(prs.headers().firstValue("ETag").isEmpty(), "the ETag filter must stay scoped to /history");
    }

    @Test
    void aRefusedRequestIsNeverAnswered304() throws Exception {
        String etag = confirmedCurrentTag();
        HttpResponse<byte[]> anonymous = http.send(HttpRequest.newBuilder(uri("/api/people/" + personId + "/history"))
                .header("If-None-Match", etag).GET().build(), HttpResponse.BodyHandlers.ofByteArray());
        assertEquals(401, anonymous.statusCode());
    }

    @Test
    void theEtagIsReadableCrossOrigin() throws Exception {
        HttpResponse<byte[]> response = http.send(HttpRequest.newBuilder(uri("/api/people/" + personId + "/history"))
                .header("Authorization", "Bearer " + token)
                .header("Origin", "http://localhost:3000")
                .GET().build(), HttpResponse.BodyHandlers.ofByteArray());
        String exposed = response.headers().firstValue("Access-Control-Expose-Headers").orElse("");
        assertTrue(exposed.toLowerCase().contains("etag"),
                "a cross-origin fetch cannot read an unexposed ETag; got: " + exposed);
    }

    // ---- Compression --------------------------------------------------------------------------

    @Test
    void historyIsGzippedAndDecodesToTheSameBodyAndTag() throws Exception {
        // Past the 2 KB threshold, so compression actually engages.
        for (int i = 0; i < 60; i++) logSet(sessionId, 100 + i, 5);

        HttpResponse<byte[]> plain = history(personId, null, false);
        HttpResponse<byte[]> gzipped = history(personId, null, true);

        assertTrue(plain.body().length > 2048, "fixture must exceed min-response-size: " + plain.body().length);
        assertEquals("gzip", gzipped.headers().firstValue("Content-Encoding").orElse(null));
        assertTrue(gzipped.body().length < plain.body().length);
        assertEquals(new String(plain.body(), StandardCharsets.UTF_8), gunzip(gzipped.body()));

        // The tag describes the content, not the encoding: a tag from a compressed response must
        // still validate, or every compressed client silently loses the 304.
        String gzippedTag = gzipped.headers().firstValue("ETag").orElseThrow();
        assertEquals(304, history(personId, gzippedTag, true).statusCode());
    }

    @Test
    void aSmallResponseIsLeftUncompressed() throws Exception {
        HttpResponse<byte[]> people = send("/api/people", null, true);
        assertEquals(200, people.statusCode());
        assertTrue(people.headers().firstValue("Content-Encoding").isEmpty());
    }

    // ---- helpers ------------------------------------------------------------------------------

    // A tag the server has JUST confirmed describes the current history (it answers 304). Every
    // "changed" test starts from one, so its later 200 cannot pass merely because tagging is off.
    private String confirmedCurrentTag() throws Exception {
        String etag = history(personId, null, false).headers().firstValue("ETag").orElseThrow();
        assertEquals(304, history(personId, etag, false).statusCode());
        return etag;
    }

    private void assertChangedTo(String staleTag, String expectedContent) throws Exception {
        HttpResponse<byte[]> response = history(personId, staleTag, false);
        assertEquals(200, response.statusCode(), "a stale tag must get the new history, never a 304");
        assertTrue(new String(response.body(), StandardCharsets.UTF_8).contains(expectedContent));
        assertNotEquals(staleTag, response.headers().firstValue("ETag").orElseThrow());
    }

    private HttpResponse<byte[]> history(long person, String ifNoneMatch, boolean gzip) throws Exception {
        return send("/api/people/" + person + "/history", ifNoneMatch, gzip);
    }

    private HttpResponse<byte[]> send(String path, String ifNoneMatch, boolean gzip) throws Exception {
        HttpRequest.Builder request = HttpRequest.newBuilder(uri(path)).header("Authorization", "Bearer " + token).GET();
        if (ifNoneMatch != null) request.header("If-None-Match", ifNoneMatch);
        if (gzip) request.header("Accept-Encoding", "gzip");
        return http.send(request.build(), HttpResponse.BodyHandlers.ofByteArray());
    }

    private URI uri(String path) {
        return URI.create("http://localhost:" + port + path);
    }

    private static String gunzip(byte[] bytes) throws IOException {
        try (GZIPInputStream in = new GZIPInputStream(new ByteArrayInputStream(bytes))) {
            return new String(in.readAllBytes(), StandardCharsets.UTF_8);
        }
    }

    private long createPastSession(long person, String startedAt) throws Exception {
        String response = mockMvc.perform(post("/api/people/" + person + "/sessions")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of("startedAt", startedAt))))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        return objectMapper.readTree(response).get("id").asLong();
    }

    private void logSet(long session, double weight, int reps) throws Exception {
        mockMvc.perform(post("/api/sessions/" + session + "/sets")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(
                                Map.of("exerciseId", exerciseId, "weight", weight, "reps", reps))))
                .andExpect(status().isOk());
    }
}
