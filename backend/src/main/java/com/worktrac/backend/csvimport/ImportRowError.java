package com.worktrac.backend.csvimport;

// One row the importer refused, identified by its line in the file the person is looking at
// (1-based, counting the header) so the message can be acted on without guessing which row it
// means.
public record ImportRowError(int line, String message) {
}
