package com.worktrac.backend.workoutset;

import com.worktrac.backend.membership.RequiresPermission;
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
    @RequiresPermission(personScoped = true)
    public LogSetResultDto logLiveSet(@PathVariable Long personId, @Valid @RequestBody LogSetRequest request) {
        return workoutSetService.logLiveSet(currentUser.access(), personId, request);
    }

    @PostMapping("/api/sessions/{sessionId}/sets")
    @RequiresPermission(personScoped = true)
    public LogSetResultDto logSetIntoSession(@PathVariable Long sessionId, @Valid @RequestBody LogSetRequest request) {
        return workoutSetService.logSetIntoSession(currentUser.access(), sessionId, request);
    }

    @GetMapping("/api/sessions/{sessionId}/sets")
    @RequiresPermission(personScoped = true)
    public List<WorkoutSetDto> listForSessionAndExercise(@PathVariable Long sessionId, @RequestParam Long exerciseId) {
        return workoutSetService.listForSessionAndExercise(currentUser.access(), sessionId, exerciseId);
    }

    @PatchMapping("/api/sets/{setId}")
    @RequiresPermission(personScoped = true)
    public WorkoutSetDto edit(@PathVariable Long setId, @Valid @RequestBody EditSetRequest request) {
        return workoutSetService.editSet(currentUser.access(), setId, request);
    }

    @DeleteMapping("/api/sets/{setId}")
    @RequiresPermission(personScoped = true)
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(@PathVariable Long setId) {
        workoutSetService.deleteSet(currentUser.access(), setId);
    }
}
