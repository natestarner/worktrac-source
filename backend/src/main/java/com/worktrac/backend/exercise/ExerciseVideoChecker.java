package com.worktrac.backend.exercise;

import net.javacrumbs.shedlock.spring.annotation.SchedulerLock;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.time.Clock;
import java.time.Instant;

/**
 * Once a day, asks YouTube whether each library video can still be embedded, and hides the ones
 * that cannot ({@code exercise_videos.status}, V94). A creator deleting a video, making it private
 * or turning embedding off would otherwise leave a play button that opens YouTube's error screen.
 *
 * <ul>
 *   <li><b>Only a definite answer changes anything.</b> UNKNOWN (a timeout, a 5xx, a rate limit)
 *       leaves the row as it was, so a YouTube outage cannot hide every video.</li>
 *   <li><b>It flips both ways.</b> A video that comes back is shown again the next day.</li>
 *   <li><b>It never deletes.</b> An unavailable row stays, so it can be replaced by a migration
 *       and the history of what was linked is kept.</li>
 * </ul>
 *
 * <p>Daily is plenty: the catalogue changes when a migration ships, and a dead video costs a
 * person one tap on YouTube's own error screen. One replica per day (SchedulingConfig).
 */
@Component
public class ExerciseVideoChecker {

    private static final Logger log = LoggerFactory.getLogger(ExerciseVideoChecker.class);

    public record Summary(int available, int unavailable, int unknown, int changed) {
    }

    private final ExerciseVideoRepository videos;
    private final VideoAvailabilityProbe probe;
    private final Clock clock;
    private final boolean enabled;

    public ExerciseVideoChecker(ExerciseVideoRepository videos, VideoAvailabilityProbe probe, Clock clock,
                                @Value("${app.videos.check-enabled:true}") boolean enabled) {
        this.videos = videos;
        this.probe = probe;
        this.clock = clock;
        this.enabled = enabled;
    }

    @Scheduled(cron = "0 30 4 * * *", zone = "UTC")
    @SchedulerLock(name = "exerciseVideoChecker", lockAtLeastFor = "PT23H", lockAtMostFor = "PT2H")
    public void checkDaily() {
        if (enabled) {
            checkAll();
        }
    }

    /** One pass over every library video. Public so tests (and an operator) can run it directly. */
    public Summary checkAll() {
        int available = 0;
        int unavailable = 0;
        int unknown = 0;
        int changed = 0;
        for (ExerciseVideoRepository.VideoRow row : videos.allForCheck()) {
            VideoAvailabilityProbe.Availability answer = probe.check(row.videoId());
            if (answer == VideoAvailabilityProbe.Availability.UNKNOWN) {
                unknown++;
                continue;
            }
            String status = answer == VideoAvailabilityProbe.Availability.AVAILABLE ? "active" : "unavailable";
            if (status.equals("active")) {
                available++;
            } else {
                unavailable++;
            }
            if (!status.equals(row.status())) {
                changed++;
                log.info("Exercise video for \"{}\" ({}) is now {}", row.exerciseName(), row.videoId(), status);
            }
            Instant now = clock.instant();
            videos.markChecked(row.id(), status, now);
        }
        if (available + unavailable + unknown > 0) {
            log.info("Exercise videos checked: {} available, {} unavailable, {} no answer, {} changed",
                    available, unavailable, unknown, changed);
        }
        return new Summary(available, unavailable, unknown, changed);
    }
}
