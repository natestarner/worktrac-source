package com.worktrac.backend.exercise;

import com.worktrac.backend.security.CurrentUser;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
@RequestMapping("/api/exercises")
public class ExerciseController {

    private final ExerciseService exerciseService;
    private final CurrentUser currentUser;

    public ExerciseController(ExerciseService exerciseService, CurrentUser currentUser) {
        this.exerciseService = exerciseService;
        this.currentUser = currentUser;
    }

    @GetMapping
    public List<ExerciseDto> list() {
        return exerciseService.list(currentUser.accountId());
    }

    @PostMapping
    public ExerciseDto add(@Valid @RequestBody ExerciseRequest request) {
        return exerciseService.add(currentUser.accountId(), request);
    }

    @PutMapping("/{exerciseId}")
    public ExerciseDto update(@PathVariable Long exerciseId, @Valid @RequestBody ExerciseRequest request) {
        return exerciseService.update(currentUser.accountId(), exerciseId, request);
    }

    @DeleteMapping("/{exerciseId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void remove(@PathVariable Long exerciseId) {
        exerciseService.remove(currentUser.accountId(), exerciseId);
    }
}
