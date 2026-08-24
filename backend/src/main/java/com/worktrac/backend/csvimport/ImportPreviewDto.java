package com.worktrac.backend.csvimport;

import java.util.List;

// What an import would do, or (with batchId set) what it just did. Preview and commit return the
// same shape deliberately: the "here's what will happen" panel and the "here's what happened"
// panel are then the same panel, and cannot describe the same import differently.
//
// batchId is null on a preview and on a commit that created nothing.
public record ImportPreviewDto(
        Long batchId,
        int sessionCount,
        int setCount,
        int skippedDuplicateCount,
        List<String> newExerciseNames,
        int notesApplied,
        int notesSkipped,
        int favoritesApplied,
        int tagsApplied,
        List<String> newTagNames,
        int sessionNotesApplied,
        // Optional columns the file didn't have, so the UI can say what was assumed in their
        // place rather than letting a default pass unremarked. A default is only honest if it is
        // visible at the moment of confirming -- see docs/architecture/import-export.md.
        List<String> appliedDefaults,
        // Columns that were read and not imported (Custom Fields, Est. 1RM), named so nothing is
        // dropped in silence.
        List<String> ignoredColumns,
        List<ImportRowError> rowErrors) {
}
