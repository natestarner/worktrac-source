package com.worktrac.backend.stats;

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
    public ExerciseSummaryDto summary(@PathVariable Long personId, @PathVariable Long exerciseId,
                                       @RequestParam(required = false) Long excludeSessionId) {
        return statsService.getSummary(currentUser.accountId(), personId, exerciseId, excludeSessionId);
    }

    @GetMapping("/api/people/{personId}/prs")
    public List<PrRowDto> prs(@PathVariable Long personId) {
        return statsService.getPrList(currentUser.accountId(), personId);
    }

    @GetMapping("/api/people/{personId}/trends/overview")
    public TrendsOverviewDto trendsOverview(@PathVariable Long personId,
                                             @RequestParam(defaultValue = "12") int weeks,
                                             @RequestParam(defaultValue = "UTC") String zone) {
        return statsService.getOverview(currentUser.accountId(), personId, weeks, zone);
    }

    @GetMapping("/api/people/{personId}/trends/exercises/{exerciseId}")
    public List<ExerciseTrendPointDto> exerciseTrend(@PathVariable Long personId, @PathVariable Long exerciseId,
                                                       @RequestParam(defaultValue = "12") int weeks,
                                                       @RequestParam(defaultValue = "UTC") String zone) {
        return statsService.getExerciseTrend(currentUser.accountId(), personId, exerciseId, weeks, zone);
    }
}
