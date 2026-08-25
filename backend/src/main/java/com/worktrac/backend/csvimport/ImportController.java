package com.worktrac.backend.csvimport;

import com.worktrac.backend.security.CurrentUser;
import jakarta.validation.Valid;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

// Reading an export-shaped CSV back into one person's history, and taking it back out again.
//
// Preview and commit both take the whole file and both parse it from scratch. The client posting
// it twice is deliberate: holding parse state server-side between two requests would be a second
// source of truth about the file, and re-deriving duplicates at commit time against live data is
// exactly what makes the commit idempotent (see CsvImportService).
//
// Every route resolves its person through CurrentUser.accountId() first, so a personId belonging
// to another account is a 404 -- indistinguishable from one that doesn't exist.
@RestController
public class ImportController {

    private final CsvImportService csvImportService;
    private final ImportUndoService importUndoService;
    private final CurrentUser currentUser;

    public ImportController(CsvImportService csvImportService, ImportUndoService importUndoService,
                             CurrentUser currentUser) {
        this.csvImportService = csvImportService;
        this.importUndoService = importUndoService;
        this.currentUser = currentUser;
    }

    // Writes nothing. Answers "what would this file do", including which rows are already present
    // and which optional columns were defaulted.
    @PostMapping("/api/people/{personId}/import/preview")
    public ImportPreviewDto preview(@PathVariable Long personId, @Valid @RequestBody ImportRequest request) {
        return csvImportService.preview(currentUser.accountId(), personId, request);
    }

    @PostMapping("/api/people/{personId}/import")
    public ImportPreviewDto commit(@PathVariable Long personId, @Valid @RequestBody ImportRequest request) {
        return csvImportService.commit(currentUser.accountId(), currentUser.userId(), personId, request);
    }

    @GetMapping("/api/people/{personId}/imports")
    public List<ImportBatchDto> list(@PathVariable Long personId) {
        return importUndoService.list(currentUser.accountId(), personId);
    }

    @DeleteMapping("/api/people/{personId}/imports/{batchId}")
    public ResponseEntity<ImportBatchDto> undo(@PathVariable Long personId, @PathVariable Long batchId) {
        return ResponseEntity.ok(importUndoService.undo(currentUser.accountId(), personId, batchId));
    }
}
