package com.worktrac.backend.workoutset;

import com.worktrac.backend.security.CurrentUser;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
public class WorkoutSetController {

    private final WorkoutSetService workoutSetService;
    private final CurrentUser currentUser;

    public WorkoutSetController(WorkoutSetService workoutSetService, CurrentUser currentUser) {
        this.workoutSetService = workoutSetService;
        this.currentUser = currentUser;
    }

    @PostMapping("/api/people/{personId}/live-sets")
    public LogSetResultDto logLiveSet(@PathVariable Long personId, @Valid @RequestBody LogSetRequest request) {
        return workoutSetService.logLiveSet(currentUser.accountId(), personId, request);
    }

    @PostMapping("/api/sessions/{sessionId}/sets")
    public LogSetResultDto logSetIntoSession(@PathVariable Long sessionId, @Valid @RequestBody LogSetRequest request) {
        return workoutSetService.logSetIntoSession(currentUser.accountId(), sessionId, request);
    }

    @GetMapping("/api/sessions/{sessionId}/sets")
    public List<WorkoutSetDto> listForSessionAndExercise(@PathVariable Long sessionId, @RequestParam Long exerciseId) {
        return workoutSetService.listForSessionAndExercise(currentUser.accountId(), sessionId, exerciseId);
    }

    @PatchMapping("/api/sets/{setId}")
    public WorkoutSetDto edit(@PathVariable Long setId, @Valid @RequestBody EditSetRequest request) {
        return workoutSetService.editSet(currentUser.accountId(), setId, request);
    }

    @DeleteMapping("/api/sets/{setId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(@PathVariable Long setId) {
        workoutSetService.deleteSet(currentUser.accountId(), setId);
    }
}
