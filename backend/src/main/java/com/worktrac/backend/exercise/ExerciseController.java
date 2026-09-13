package com.worktrac.backend.exercise;

import com.worktrac.backend.membership.RequiresPermission;
import com.worktrac.backend.membership.Permission;
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
    @RequiresPermission(anyMember = true)
    public List<ExerciseDto> list() {
        return exerciseService.list(currentUser.access());
    }

    @PostMapping
    @RequiresPermission(Permission.CREATE_SHARED_RESOURCE)
    public ExerciseDto add(@Valid @RequestBody ExerciseRequest request) {
        return exerciseService.add(currentUser.access(), request);
    }

    // ⚠️ EDIT_OWN, not EDIT_ANY -- so this annotation admits every member, on purpose. An
    // interceptor cannot know who created the row behind {exerciseId}, so the real decision moved
    // into ExerciseService.update (AccountAccess.mayEditSharedResource). Loosening this without
    // that check in place hands every member the whole household's catalog, and
    // HandlerPermissionCoverageTest will not notice -- it asserts an annotation exists, not which.
    @PutMapping("/{exerciseId}")
    @RequiresPermission(Permission.EDIT_OWN_SHARED_RESOURCE)
    public ExerciseDto update(@PathVariable Long exerciseId, @Valid @RequestBody ExerciseRequest request) {
        return exerciseService.update(currentUser.access(), exerciseId, request);
    }

    @DeleteMapping("/{exerciseId}")
    @RequiresPermission(Permission.DELETE_SHARED_RESOURCE)
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void remove(@PathVariable Long exerciseId) {
        exerciseService.remove(currentUser.accountId(), exerciseId);
    }
}
