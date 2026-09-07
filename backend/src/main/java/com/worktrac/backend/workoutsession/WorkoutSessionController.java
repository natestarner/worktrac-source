package com.worktrac.backend.workoutsession;

import com.worktrac.backend.membership.RequiresPermission;
import com.worktrac.backend.security.CurrentUser;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
public class WorkoutSessionController {

    private final WorkoutSessionService workoutSessionService;
    private final CurrentUser currentUser;

    public WorkoutSessionController(WorkoutSessionService workoutSessionService, CurrentUser currentUser) {
        this.workoutSessionService = workoutSessionService;
        this.currentUser = currentUser;
    }

    @GetMapping("/api/people/{personId}/sessions/live")
    @RequiresPermission(personScoped = true)
    public ResponseEntity<WorkoutSessionDto> getLive(@PathVariable Long personId) {
        return workoutSessionService.getLiveSessionDto(currentUser.access(), personId)
                .map(ResponseEntity::ok)
                .orElseGet(() -> ResponseEntity.noContent().build());
    }

    @PostMapping("/api/people/{personId}/sessions/live/end")
    @RequiresPermission(personScoped = true)
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void endWorkout(@PathVariable Long personId) {
        workoutSessionService.endWorkout(currentUser.access(), personId);
    }

    @PostMapping("/api/people/{personId}/sessions")
    @RequiresPermission(personScoped = true)
    public WorkoutSessionDto createPastSession(@PathVariable Long personId,
                                                @Valid @RequestBody CreatePastSessionRequest request) {
        return workoutSessionService.createPastSession(currentUser.access(), personId, request.startedAt());
    }

    @PatchMapping("/api/sessions/{sessionId}")
    @RequiresPermission(personScoped = true)
    public WorkoutSessionDto edit(@PathVariable Long sessionId, @Valid @RequestBody EditSessionRequest request) {
        return workoutSessionService.editSession(currentUser.access(), sessionId, request.startedAt());
    }

    @GetMapping("/api/people/{personId}/history")
    @RequiresPermission(personScoped = true)
    public List<HistorySessionDto> history(@PathVariable Long personId) {
        return workoutSessionService.getHistory(currentUser.access(), personId);
    }

    // How much of this person's history the Free-tier window is hiding. Its own endpoint rather than
    // an envelope around /history, because all three clamped screens ask the same question and only
    // one of them reads the history list -- and because widening /history's response from a bare
    // array to an object would break every persisted query cache written by an older build (the
    // axis-D case in .claude/rules/resilience.md).
    @GetMapping("/api/people/{personId}/history-window")
    @RequiresPermission(personScoped = true)
    public HistoryWindowDto historyWindow(@PathVariable Long personId) {
        return workoutSessionService.getHistoryWindow(currentUser.access(), personId);
    }
}
