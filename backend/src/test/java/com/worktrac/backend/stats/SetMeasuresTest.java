package com.worktrac.backend.stats;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.worktrac.backend.workoutset.WorkoutSet;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.DynamicTest;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestFactory;

import java.io.IOException;
import java.math.BigDecimal;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.function.Function;
import java.util.stream.Stream;

import static org.assertj.core.api.Assertions.assertThat;

// Runs the SAME cases as frontend/src/utils/formulas.test.js, from the same file:
// shared/record-rules/set-measures-cases.json. That file is the est.-1RM / top-weight rule; this
// test and its JS twin are what stop the server (PRs board, records table, Trends chart, isPR at log
// time) and the client (the celebration, History's and the Log screen's badges, the offline
// fallback) from computing it differently.
//
// Every comparison is EXACT (BigDecimal#compareTo against the case's string). Both sides now compute
// in exact arithmetic, so a tolerance here would only hide the next rounding disagreement -- which
// is precisely what the hand-copied cases this replaces did for the x.x5 ties.
class SetMeasuresTest {

    // Maven runs from backend/, and CI checks out the whole repo, so the shared file is one level up.
    private static final Path CASES = Path.of("..", "shared", "record-rules", "set-measures-cases.json");

    private static JsonNode cases;

    private final EpleyCalculator epley = new EpleyCalculator();
    private final UnitConverter unitConverter = new UnitConverter();
    private final SetMeasures setMeasures = new SetMeasures(epley, unitConverter);

    @BeforeAll
    static void load() throws IOException {
        cases = new ObjectMapper().readTree(Files.readString(CASES));
    }

    @Test
    void theConstantsMatchTheSharedFile() {
        assertThat(EpleyCalculator.EST_1RM_REP_CAP).isEqualTo(cases.get("estRepCap").asInt());
        assertThat(unitConverter.toLb(BigDecimal.ONE, WorkoutSet.UNIT_KG))
                .isEqualByComparingTo(new BigDecimal(cases.get("lbPerKg").asText()));
    }

    @TestFactory
    Stream<DynamicTest> epley() {
        return each("epley", c -> epley.estimate1RM(decimal(c.get("weight")), c.get("reps").asInt()));
    }

    @TestFactory
    Stream<DynamicTest> toLb() {
        return each("toLb", c -> unitConverter.toLb(decimal(c.get("weight")), c.get("unit").asText()));
    }

    @TestFactory
    Stream<DynamicTest> comparableValue() {
        return each("comparableValue", c -> setMeasures.comparableValue(toSet(c.get("set"))));
    }

    @TestFactory
    Stream<DynamicTest> weightLb() {
        return each("weightLb", c -> setMeasures.weightLb(toSet(c.get("set"))));
    }

    private Stream<DynamicTest> each(String group, Function<JsonNode, BigDecimal> compute) {
        List<DynamicTest> tests = new ArrayList<>();
        for (JsonNode c : cases.get(group)) {
            tests.add(DynamicTest.dynamicTest(group + ": " + c.get("name").asText(), () ->
                    assertThat(compute.apply(c)).isEqualByComparingTo(new BigDecimal(c.get("expected").asText()))));
        }
        assertThat(tests).as("no '%s' cases in the shared file", group).isNotEmpty();
        return tests.stream();
    }

    // Through the string form, never the double, so 32.52 is 32.52 and not 32.5199999...
    private static BigDecimal decimal(JsonNode number) {
        return new BigDecimal(number.asText());
    }

    private static WorkoutSet toSet(JsonNode set) {
        Integer duration = set.hasNonNull("durationSeconds") ? set.get("durationSeconds").asInt() : null;
        return new WorkoutSet(null, null, null, decimal(set.get("weight")), set.get("reps").asInt(), duration,
                set.get("unit").asText(), null, null, null);
    }
}
