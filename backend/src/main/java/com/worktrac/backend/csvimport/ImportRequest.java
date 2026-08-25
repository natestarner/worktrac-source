package com.worktrac.backend.csvimport;

import jakarta.validation.constraints.NotNull;

// The file's text, plus what it was called so the Recent-imports list can name it.
//
// JSON rather than multipart: the backend has never configured multipart, and an .xlsx workbook
// is converted to CSV in the browser before it gets here, so the wire only ever carries CSV.
// See docs/architecture/import-export.md.
public record ImportRequest(@NotNull String csv, String filename) {
}
