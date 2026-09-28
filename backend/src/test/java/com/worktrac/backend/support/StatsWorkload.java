package com.worktrac.backend.support;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

import java.time.DayOfWeek;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Random;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

// HistoryWorkload's writes, plus the ones the PRs board and Trends are most sensitive to and that
// HistoryWorkload never makes: bodyweight sets (weight 0), holds (a duration exercise, with and
// without added load), kg sets (import is the only way a set carries a unit other than the
// account's), exact repeats of a set (ties at the best), and workouts at the edge of a week or day
// in another time zone. Interleaved by its OWN random stream, so HistoryWorkload -- and every
// HistoryConvergenceTest seed -- is unchanged by this existing.
public final class StatsWorkload {

    private final HistoryWorkload history;
    private final MockMvc mockMvc;
    private final ObjectMapper objectMapper;
    private final String token;
    private final long personId;
    private final long bodyweightExerciseId;
    private final long holdExerciseId;
    private final String holdExerciseName;
    private final List<String> strengthExerciseNames;
    private final MutableClock clock;
    private final Random random;
    private Map<String, Object> lastLiveSet;

    public StatsWorkload(HistoryWorkload history, MockMvc mockMvc, ObjectMapper objectMapper, String token,
                         long personId, long bodyweightExerciseId, long holdExerciseId, String holdExerciseName,
                         List<String> strengthExerciseNames, MutableClock clock, long seed) {
        this.history = history;
        this.mockMvc = mockMvc;
        this.objectMapper = objectMapper;
        this.token = token;
        this.personId = personId;
        this.bodyweightExerciseId = bodyweightExerciseId;
        this.holdExerciseId = holdExerciseId;
        this.holdExerciseName = holdExerciseName;
        this.strengthExerciseNames = strengthExerciseNames;
        this.clock = clock;
        this.random = new Random(seed ^ 0x57A75L);
    }

    public String step() throws Exception {
        int roll = random.nextInt(100);
        if (roll < 65) return history.step();
        if (roll < 71) return liveSet("bodyweight set", Map.of("exerciseId", bodyweightExerciseId, "weight", 0,
                "reps", 1 + random.nextInt(20)));
        if (roll < 77) return liveSet("hold", Map.of("exerciseId", holdExerciseId,
                "weight", random.nextInt(3) == 0 ? 10 * (1 + random.nextInt(4)) : 0,
                "reps", 0, "durationSeconds", 15 + random.nextInt(106)));
        if (roll < 84) return repeatLastSet();
        if (roll < 91) return importKg();
        if (roll < 96) return importAtWeekEdge();
        return importHolds();
    }

    private String liveSet(String what, Map<String, Object> body) throws Exception {
        if (send(post("/api/people/" + personId + "/live-sets"), body)) lastLiveSet = body;
        return what;
    }

    // The exact same payload again: a tie with a set already logged, often the current best.
    private String repeatLastSet() throws Exception {
        if (lastLiveSet == null) return history.step();
        send(post("/api/people/" + personId + "/live-sets"), lastLiveSet);
        return "repeat of " + lastLiveSet;
    }

    private String importKg() throws Exception {
        StringBuilder csv = new StringBuilder("Exercise,Date,Time,Weight,Unit,Reps\n");
        int rows = 1 + random.nextInt(4);
        for (int i = 0; i < rows; i++) {
            csv.append(pick(strengthExerciseNames)).append(',').append(pastDate()).append(',')
                    .append(String.format("%02d:%02d", random.nextInt(24), random.nextInt(60))).append(',')
                    // Quarter-kilos included: kg to lb is where rounding has disagreed before.
                    .append(String.format("%.2f", 2.5 * (4 + random.nextInt(50)) + (random.nextInt(4) == 0 ? 0.25 : 0)))
                    .append(",kg,").append(1 + random.nextInt(12)).append('\n');
        }
        importCsv(csv);
        return "import " + rows + " kg rows";
    }

    // A workout at 23:30 on a Sunday or 01:30 on a Monday, UTC: the same instant falls in a different
    // week (or day) depending on the viewer's zone.
    private String importAtWeekEdge() throws Exception {
        LocalDate date = pastDate();
        boolean sunday = random.nextBoolean();
        date = date.with(sunday ? DayOfWeek.SUNDAY : DayOfWeek.MONDAY);
        if (date.isAfter(LocalDate.ofInstant(clock.instant(), ZoneOffset.UTC))) date = date.minusWeeks(1);
        String csv = "Exercise,Date,Time,Weight,Unit,Reps\n" + pick(strengthExerciseNames) + ',' + date + ','
                + (sunday ? "23:30" : "01:30") + ',' + 5 * (4 + random.nextInt(40)) + ",lb," + (1 + random.nextInt(10)) + '\n';
        importCsv(new StringBuilder(csv));
        return "import at a week edge " + date;
    }

    private String importHolds() throws Exception {
        StringBuilder csv = new StringBuilder("Exercise,Date,Weight,Unit,Duration (sec)\n");
        int rows = 1 + random.nextInt(3);
        for (int i = 0; i < rows; i++) {
            csv.append(holdExerciseName).append(',').append(pastDate()).append(',')
                    .append(random.nextBoolean() ? 0 : 20).append(",lb,").append(10 + random.nextInt(150)).append('\n');
        }
        importCsv(csv);
        return "import " + rows + " holds";
    }

    private void importCsv(StringBuilder csv) throws Exception {
        send(post("/api/people/" + personId + "/import"), Map.of("csv", csv.toString(), "filename", "stats.csv"));
    }

    private boolean send(MockHttpServletRequestBuilder request, Map<String, Object> body) throws Exception {
        request.header("Authorization", "Bearer " + token)
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(new LinkedHashMap<>(body)));
        int status = mockMvc.perform(request).andReturn().getResponse().getStatus();
        if (status >= 500) throw new IllegalStateException("a stats write answered " + status + ": " + body);
        return status < 400;
    }

    private LocalDate pastDate() {
        // Up to ~13 months back: inside and outside the Free window, across month and year edges.
        return LocalDate.ofInstant(clock.instant(), ZoneOffset.UTC).minusDays(1 + random.nextInt(400));
    }

    private <T> T pick(List<T> list) {
        return list.get(random.nextInt(list.size()));
    }
}
