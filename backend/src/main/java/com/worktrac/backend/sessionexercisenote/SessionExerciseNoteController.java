package com.worktrac.backend.sessionexercisenote;

import com.worktrac.backend.membership.RequiresPermission;
import com.worktrac.backend.security.CurrentUser;
import jakarta.validation.Valid;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class SessionExerciseNoteController {

    private final SessionExerciseNoteService sessionExerciseNoteService;
    private final CurrentUser currentUser;

    public SessionExerciseNoteController(SessionExerciseNoteService sessionExerciseNoteService, CurrentUser currentUser) {
        this.sessionExerciseNoteService = sessionExerciseNoteService;
        this.currentUser = currentUser;
    }

    @PutMapping("/api/people/{personId}/live-exercise-notes")
    @RequiresPermission(personScoped = true)
    public SessionExerciseNoteDto saveLiveNote(@PathVariable Long personId, @Valid @RequestBody LiveExerciseNoteRequest request) {
        return sessionExerciseNoteService.upsertLiveNote(currentUser.access(), personId, request.exerciseId(), request.note());
    }

    @PutMapping("/api/sessions/{sessionId}/exercises/{exerciseId}/note")
    @RequiresPermission(personScoped = true)
    public SessionExerciseNoteDto saveSessionNote(@PathVariable Long sessionId, @PathVariable Long exerciseId,
                                                   @Valid @RequestBody ExerciseNoteRequest request) {
        return sessionExerciseNoteService.upsertSessionNote(currentUser.access(), sessionId, exerciseId, request.note());
    }

    @GetMapping("/api/sessions/{sessionId}/exercises/{exerciseId}/note")
    @RequiresPermission(personScoped = true)
    public ResponseEntity<SessionExerciseNoteDto> getNote(@PathVariable Long sessionId, @PathVariable Long exerciseId) {
        return sessionExerciseNoteService.getNote(currentUser.access(), sessionId, exerciseId)
                .map(ResponseEntity::ok)
                .orElseGet(() -> ResponseEntity.noContent().build());
    }
}
