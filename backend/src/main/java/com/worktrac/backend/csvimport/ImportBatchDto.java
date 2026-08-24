package com.worktrac.backend.csvimport;

import java.time.Instant;

public record ImportBatchDto(
        Long id,
        String filename,
        int setCount,
        int sessionCount,
        int skippedDuplicateCount,
        Instant createdAt,
        Instant undoneAt) {

    public static ImportBatchDto from(ImportBatch batch) {
        return new ImportBatchDto(batch.getId(), batch.getFilename(), batch.getSetCount(),
                batch.getSessionCount(), batch.getSkippedDuplicateCount(), batch.getCreatedAt(),
                batch.getUndoneAt());
    }
}
