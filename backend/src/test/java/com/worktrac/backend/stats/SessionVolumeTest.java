package com.worktrac.backend.stats;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.worktrac.backend.workoutset.WorkoutSet;
import org.junit.jupiter.api.DynamicTest;
import org.junit.jupiter.api.TestFactory;

import java.io.IOException;
import java.math.BigDecimal;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.stream.Stream;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.within;

// Runs the SAME cases as frontend/src/utils/sessionVolume.test.js, from the same file:
// shared/record-rules/session-volume-cases.json. That file is the session-volume rule; this test
// and its JS twin are what stop the server (PRs board, records table, Trends chart, the
// celebration's prior best) and the client (the celebration itself, History's and the Log screen's
// badges) from computing it differently.
//
// The server never decides whether a session TAKES the record -- only the client does -- so the
// cases' `records` column is checked on the JS side alone. Kind and per-session volume are
// checked on both.
class SessionVolumeTest {

    // Maven runs from backend/, and CI checks out the whole repo, so the shared file is one level up.
    private static final Path CASES = Path.of("..", "shared", "record-rules", "session-volume-cases.json");

    private final SessionVolume sessionVolume =
            new SessionVolume(new SetMeasures(new EpleyCalculator(), new UnitConverter()));

    @TestFactory
    Stream<DynamicTest> theSharedRule() throws IOException {
        JsonNode cases = new ObjectMapper().readTree(Files.readString(CASES)).get("cases");
        List<DynamicTest> tests = new ArrayList<>();
        for (JsonNode c : cases) {
            tests.add(DynamicTest.dynamicTest(c.get("name").asText(), () -> check(c)));
        }
        assertThat(tests).as("the shared case file is empty or unreadable").isNotEmpty();
        return tests.stream();
    }

    private void check(JsonNode c) {
        boolean durationTracked = c.get("durationTracked").asBoolean();
        List<List<WorkoutSet>> sessions = new ArrayList<>();
        List<WorkoutSet> all = new ArrayList<>();
        for (JsonNode session : c.get("sessions")) {
            List<WorkoutSet> sets = new ArrayList<>();
            for (JsonNode set : session) sets.add(toSet(set));
            sessions.add(sets);
            all.addAll(sets);
        }
        JsonNode expected = c.get("expected");

        SessionVolume.Kind kind = sessionVolume.kindOf(durationTracked, all);
        String expectedKind = expected.get("kind").isNull() ? null : expected.get("kind").asText();
        // A duration exercise is SECONDS from its tracking type even with nothing logged; the shared
        // "nothing logged" case is a strength exercise, where both sides answer null.
        assertThat(kind == null ? null : kind.wire()).isEqualTo(expectedKind);

        JsonNode volumes = expected.get("sessionVolumes");
        assertThat(sessions).hasSize(volumes.size());
        for (int i = 0; i < sessions.size(); i++) {
            assertThat(sessionVolume.sessionVolume(sessions.get(i), kind).doubleValue())
                    .isCloseTo(volumes.get(i).asDouble(), within(0.01));
        }
    }

    private static WorkoutSet toSet(JsonNode set) {
        Integer duration = set.hasNonNull("durationSeconds") ? set.get("durationSeconds").asInt() : null;
        return new WorkoutSet(null, null, null, new BigDecimal(set.get("weight").asText()),
                set.get("reps").asInt(), duration, set.get("unit").asText(), null, null, null);
    }
}
