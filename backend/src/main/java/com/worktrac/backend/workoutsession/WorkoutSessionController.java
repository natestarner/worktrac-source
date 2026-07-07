package com.worktrac.backend.workoutsession;

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
    public ResponseEntity<WorkoutSessionDto> getLive(@PathVariable Long personId) {
        return workoutSessionService.getLiveSessionDto(currentUser.accountId(), personId)
                .map(ResponseEntity::ok)
                .orElseGet(() -> ResponseEntity.noContent().build());
    }

    @PostMapping("/api/people/{personId}/sessions/live/end")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void endWorkout(@PathVariable Long personId) {
        workoutSessionService.endWorkout(currentUser.accountId(), personId);
    }

    @PostMapping("/api/people/{personId}/sessions")
    public WorkoutSessionDto createPastSession(@PathVariable Long personId,
                                                @Valid @RequestBody CreatePastSessionRequest request) {
        return workoutSessionService.createPastSession(currentUser.accountId(), personId, request.startedAt());
    }

    @PatchMapping("/api/sessions/{sessionId}")
    public WorkoutSessionDto edit(@PathVariable Long sessionId, @Valid @RequestBody EditSessionRequest request) {
        return workoutSessionService.editSession(currentUser.accountId(), sessionId, request.startedAt());
    }

    @GetMapping("/api/people/{personId}/history")
    public List<HistorySessionDto> history(@PathVariable Long personId) {
        return workoutSessionService.getHistory(currentUser.accountId(), personId);
    }
}
