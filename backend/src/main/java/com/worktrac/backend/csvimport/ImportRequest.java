package com.worktrac.backend.csvimport;

import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

// The file's text, plus what it was called so the Recent-imports list can name it.
//
// JSON rather than multipart: the backend has never configured multipart, and an .xlsx workbook
// is converted to CSV in the browser before it gets here, so the wire only ever carries CSV.
// See docs/architecture/import-export.md.
public record ImportRequest(
        @NotNull String csv,
        @Size(max = 255, message = "must be 255 characters or fewer") String filename) {
}
