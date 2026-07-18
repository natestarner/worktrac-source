package com.worktrac.backend.sessionexercisenote;

// note is null when the note has been cleared (blank save deletes the underlying row).
public record SessionExerciseNoteDto(Long sessionId, Long exerciseId, String note) {
}
