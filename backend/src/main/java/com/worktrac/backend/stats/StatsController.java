package com.worktrac.backend.stats;

import com.worktrac.backend.membership.RequiresPermission;
import com.worktrac.backend.security.CurrentUser;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
public class StatsController {

    private final StatsService statsService;
    private final CurrentUser currentUser;

    public StatsController(StatsService statsService, CurrentUser currentUser) {
        this.statsService = statsService;
        this.currentUser = currentUser;
    }

    @GetMapping("/api/people/{personId}/exercises/{exerciseId}/summary")
    @RequiresPermission(personScoped = true)
    public ExerciseSummaryDto summary(@PathVariable Long personId, @PathVariable Long exerciseId,
                                       @RequestParam(required = false) Long excludeSessionId) {
        return statsService.getSummary(currentUser.access(), personId, exerciseId, excludeSessionId);
    }

    @GetMapping("/api/people/{personId}/prs")
    @RequiresPermission(personScoped = true)
    public List<PrRowDto> prs(@PathVariable Long personId) {
        return statsService.getPrList(currentUser.access(), personId);
    }

    // All-time, so no `weeks` param -- a record isn't relative to the range you're viewing. `zone`
    // is still needed to date each record in the viewer's local calendar.
    @GetMapping("/api/people/{personId}/exercises/{exerciseId}/records")
    @RequiresPermission(personScoped = true)
    public ExerciseRecordsDto exerciseRecords(@PathVariable Long personId, @PathVariable Long exerciseId,
                                               @RequestParam(defaultValue = "UTC") String zone) {
        return statsService.getExerciseRecords(currentUser.access(), personId, exerciseId, zone);
    }

    @GetMapping("/api/people/{personId}/trends/overview")
    @RequiresPermission(personScoped = true)
    public TrendsOverviewDto trendsOverview(@PathVariable Long personId,
                                             @RequestParam(defaultValue = "12") int weeks,
                                             @RequestParam(defaultValue = "UTC") String zone) {
        return statsService.getOverview(currentUser.access(), personId, weeks, zone);
    }

    @GetMapping("/api/people/{personId}/trends/exercises/{exerciseId}")
    @RequiresPermission(personScoped = true)
    public List<ExerciseTrendPointDto> exerciseTrend(@PathVariable Long personId, @PathVariable Long exerciseId,
                                                       @RequestParam(defaultValue = "12") int weeks,
                                                       @RequestParam(defaultValue = "UTC") String zone) {
        return statsService.getExerciseTrend(currentUser.access(), personId, exerciseId, weeks, zone);
    }
}
