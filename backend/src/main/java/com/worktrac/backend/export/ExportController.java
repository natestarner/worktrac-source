package com.worktrac.backend.export;

import com.worktrac.backend.security.CurrentUser;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RestController;

import java.nio.charset.StandardCharsets;

@RestController
public class ExportController {

    private final CsvExportService csvExportService;
    private final CurrentUser currentUser;

    public ExportController(CsvExportService csvExportService, CurrentUser currentUser) {
        this.csvExportService = csvExportService;
        this.currentUser = currentUser;
    }

    @GetMapping("/api/people/{personId}/export.csv")
    public ResponseEntity<byte[]> export(@PathVariable Long personId) {
        CsvExportService.CsvExport export = csvExportService.export(currentUser.accountId(), personId);
        byte[] body = export.content().getBytes(StandardCharsets.UTF_8);

        return ResponseEntity.ok()
                .contentType(MediaType.parseMediaType("text/csv"))
                .header(HttpHeaders.CONTENT_DISPOSITION,
                        ContentDisposition.attachment().filename(export.filename()).build().toString())
                .body(body);
    }
}
