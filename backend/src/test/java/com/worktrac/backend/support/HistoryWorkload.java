package com.worktrac.backend.support;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.RequestBuilder;

import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Random;
import java.util.function.Consumer;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;

// Random, reproducible sequences of every write a person can make that reaches History, driven
// through the real API: live sets, past workouts and sets into them, edits, deletes, notes (and
// clearing them), ending a workout, moving any workout -- including a live one -- to another date,
// renaming an exercise, importing and undoing, and optionally the account-wide levers (plan changes,
// the clock moving on) and writes to a sibling person (which must never move this person's History).
//
// A refused write (any 4xx) is a legitimate outcome and simply changes nothing -- the property under
// test holds regardless. A 5xx is reported to the caller, which decides whether it is a failure
// (single-threaded, it always is; under contention a deadlocked write is a 500 the outbox would
// replay, and History must still converge).
public final class HistoryWorkload {

    private final MockMvc mockMvc;
    private final ObjectMapper objectMapper;
    private final String token;
    private final long personId;
    private final Long otherPersonId;
    private final List<Long> exerciseIds;
    private final long renamableExerciseId;
    private final MutableClock clock;
    private final Consumer<Boolean> setFullHistory;
    private final Random random;

    private final List<Long> sessions = new ArrayList<>();
    private final List<Long> sets = new ArrayList<>();
    private final List<Long> importBatches = new ArrayList<>();
    private final Map<Long, Long> setSession = new java.util.HashMap<>();
    private Long touchedSession;
    private String touchedStartedAt;
    private boolean fullHistory = true;
    private int serverErrors;
    // action -> { accepted, refused }: so a run can prove it exercised each write for real rather
    // than passing on a stream of refusals.
    private final Map<String, int[]> outcomes = new java.util.TreeMap<>();

    // `clock` and `setFullHistory` may be null: a workload without them never changes the account-wide
    // levers (what concurrent writers want -- they share one clock and one plan).
    public HistoryWorkload(MockMvc mockMvc, ObjectMapper objectMapper, String token, long personId, Long otherPersonId,
                           List<Long> exerciseIds, long renamableExerciseId, MutableClock clock,
                           Consumer<Boolean> setFullHistory, long seed) {
        this.mockMvc = mockMvc;
        this.objectMapper = objectMapper;
        this.token = token;
        this.personId = personId;
        this.otherPersonId = otherPersonId;
        this.exerciseIds = exerciseIds;
        this.renamableExerciseId = renamableExerciseId;
        this.clock = clock;
        this.setFullHistory = setFullHistory;
        this.random = new Random(seed);
    }

    public int serverErrors() {
        return serverErrors;
    }

    public Map<String, int[]> outcomes() {
        return outcomes;
    }

    // The workout the last step's write touched on the main person, for a scoped sync -- the way the
    // app knows which workout its own write went to. Null when the step was not such a write (an
    // import, a rename, a plan change, the clock, the sibling), or was one the app refreshes in full
    // (ending a workout, moving one).
    public Long touchedSession() {
        return touchedSession;
    }

    // The touched workout's start time as the write's own response gave it, when it gave one (a
    // logged set, a new past workout) -- otherwise null, and the app uses the time it holds.
    public String touchedStartedAt() {
        return touchedStartedAt;
    }

    // One random write. Returns what it did, for failure messages.
    public String step() throws Exception {
        touchedSession = null;
        touchedStartedAt = null;
        int roll = random.nextInt(100);
        if (roll < 18) return liveSet();
        if (roll < 24) return pastSession();
        if (roll < 37) return setIntoWorkout();
        if (roll < 46) return editSet();
        if (roll < 53) return deleteSet();
        if (roll < 61) return note();
        if (roll < 65) return endWorkout();
        if (roll < 71) return moveWorkout();
        if (roll < 74) return renameExercise();
        if (roll < 78) return importFile();
        // Undo is only possible after an accepted import (Free refuses them), so it gets a wider band.
        if (roll < 83) return undoImport();
        if (roll < 86 && setFullHistory != null) return togglePlan();
        if (roll < 91 && clock != null) return advanceClock();
        if (roll < 96 && otherPersonId != null) return siblingWrite();
        return liveSet();
    }

    private String liveSet() throws Exception {
        JsonNode result = send("live set", post("/api/people/" + personId + "/live-sets"),
                Map.of("exerciseId", exercise(), "weight", weight(), "reps", 1 + random.nextInt(12)));
        if (result != null) {
            long set = result.get("set").get("id").asLong();
            sets.add(set);
            long session = result.get("session").get("id").asLong();
            if (!sessions.contains(session)) sessions.add(session);
            setSession.put(set, session);
            touch(session, result.get("session").get("startedAt").asText());
        }
        return "live set";
    }

    private String pastSession() throws Exception {
        String startedAt = pastInstant().toString();
        JsonNode result = send("past workout", post("/api/people/" + personId + "/sessions"), Map.of("startedAt", startedAt));
        if (result != null) {
            sessions.add(result.get("id").asLong());
            touch(result.get("id").asLong(), result.get("startedAt").asText());
        }
        return "past workout at " + startedAt;
    }

    private String setIntoWorkout() throws Exception {
        if (sessions.isEmpty()) return pastSession();
        long session = pick(sessions);
        JsonNode result = send("set into workout", post("/api/sessions/" + session + "/sets"),
                Map.of("exerciseId", exercise(), "weight", weight(), "reps", 1 + random.nextInt(12)));
        if (result != null) {
            long set = result.get("set").get("id").asLong();
            sets.add(set);
            setSession.put(set, session);
            touch(session, null);
        }
        return "set into workout " + session;
    }

    private String editSet() throws Exception {
        if (sets.isEmpty()) return liveSet();
        long set = pick(sets);
        if (send("edit set", patch("/api/sets/" + set), Map.of("weight", weight(), "reps", 1 + random.nextInt(12))) != null) {
            touch(setSession.get(set), null);
        }
        return "edit set " + set;
    }

    private String deleteSet() throws Exception {
        if (sets.isEmpty()) return liveSet();
        long set = sets.remove(random.nextInt(sets.size()));
        if (send("delete set", delete("/api/sets/" + set), null) != null) {
            touch(setSession.remove(set), null);
        }
        return "delete set " + set;
    }

    private String note() throws Exception {
        if (sessions.isEmpty()) return pastSession();
        long session = pick(sessions);
        // A blank save deletes the note row -- a delete the fingerprint must see too.
        String text = random.nextInt(4) == 0 ? "   " : "note " + random.nextInt(1000);
        if (send("note", put("/api/sessions/" + session + "/exercises/" + exercise() + "/note"), Map.of("note", text)) != null) {
            touch(session, null);
        }
        return "note on workout " + session + (text.isBlank() ? " (cleared)" : "");
    }

    private String endWorkout() throws Exception {
        send("end workout", post("/api/people/" + personId + "/sessions/live/end"), null);
        return "end workout";
    }

    // Any workout, the live one included, to a random earlier date -- often into another month.
    private String moveWorkout() throws Exception {
        if (sessions.isEmpty()) return pastSession();
        long session = pick(sessions);
        String startedAt = pastInstant().toString();
        send("move workout", patch("/api/sessions/" + session), Map.of("startedAt", startedAt));
        return "move workout " + session + " to " + startedAt;
    }

    private String renameExercise() throws Exception {
        String name = "Custom Lift " + random.nextInt(100000);
        send("rename exercise", put("/api/exercises/" + renamableExerciseId), Map.of("name", name));
        return "rename exercise to " + name;
    }

    private String importFile() throws Exception {
        StringBuilder csv = new StringBuilder("Exercise,Date,Reps\n");
        int rows = 1 + random.nextInt(3);
        for (int i = 0; i < rows; i++) {
            LocalDate date = LocalDate.ofInstant(pastInstant(), ZoneOffset.UTC);
            csv.append(random.nextBoolean() ? "Barbell Bench Press" : "Pull-up").append(',').append(date)
                    .append(',').append(1 + random.nextInt(12)).append('\n');
        }
        JsonNode result = send("import", post("/api/people/" + personId + "/import"),
                Map.of("csv", csv.toString(), "filename", "workouts.csv"));
        if (result != null && result.has("batchId")) importBatches.add(result.get("batchId").asLong());
        return "import " + rows + " rows";
    }

    private String undoImport() throws Exception {
        if (importBatches.isEmpty()) return importFile();
        long batch = importBatches.remove(random.nextInt(importBatches.size()));
        send("undo import", delete("/api/people/" + personId + "/imports/" + batch), null);
        return "undo import " + batch;
    }

    private String togglePlan() {
        fullHistory = !fullHistory;
        setFullHistory.accept(fullHistory);
        return fullHistory ? "upgrade to Plus" : "downgrade to Free";
    }

    private String advanceClock() {
        Duration by = random.nextBoolean()
                ? Duration.ofMinutes(1 + random.nextInt(600))
                : Duration.ofDays(1 + random.nextInt(20));
        clock.advance(by);
        return "clock +" + by;
    }

    private String siblingWrite() throws Exception {
        send("sibling's set", post("/api/people/" + otherPersonId + "/live-sets"),
                Map.of("exerciseId", exercise(), "weight", weight(), "reps", 1 + random.nextInt(12)));
        return "sibling's set";
    }

    // ── Helpers ──────────────────────────────────────────────────────────────────────────────

    // A set imported by a CSV has no known workout here, so an edit or delete of one scopes to nothing
    // and the test treats it like any write the app refreshes in full.
    private void touch(Long session, String startedAt) {
        touchedSession = session;
        touchedStartedAt = startedAt;
    }

    // A 2xx body (or an empty node), null for a refused write.
    private JsonNode send(String action, org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder request,
                          Object body) throws Exception {
        request.header("Authorization", "Bearer " + token);
        if (body != null) request.contentType(MediaType.APPLICATION_JSON).content(objectMapper.writeValueAsString(body));
        MockHttpServletResponse response = mockMvc.perform((RequestBuilder) request).andReturn().getResponse();
        int status = response.getStatus();
        if (status >= 500) {
            serverErrors++;
            return null;
        }
        if (status >= 400) {
            outcomes.computeIfAbsent(action, a -> new int[2])[1]++;
            return null;
        }
        outcomes.computeIfAbsent(action, a -> new int[2])[0]++;
        String content = response.getContentAsString();
        return content.isBlank() ? objectMapper.createObjectNode() : objectMapper.readTree(content);
    }

    // Anywhere in the last ~14 months, to the second, so months, month boundaries, the Free window and
    // today are all reachable.
    private Instant pastInstant() {
        Instant now = clock != null ? clock.instant() : Instant.now();
        return now.minus(Duration.ofSeconds(60 + (long) (random.nextDouble() * 420 * 24 * 3600)))
                .truncatedTo(java.time.temporal.ChronoUnit.SECONDS);
    }

    private long exercise() {
        return random.nextInt(4) == 0 ? renamableExerciseId : pick(exerciseIds);
    }

    private double weight() {
        return 5 * (1 + random.nextInt(60));
    }

    private <T> T pick(List<T> list) {
        return list.get(random.nextInt(list.size()));
    }
}
