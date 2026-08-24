package com.worktrac.backend.csvimport;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

// Removes every import batch belonging to a set of accounts, in the one order the foreign keys
// permit. Shared by AccountDeletionService and TestDataCleanupService so the ordering lives in a
// single place instead of being rediscovered -- wrongly -- in each of them.
//
// The ordering is not obvious, because the constraints are circular:
//
//   workout_sets.import_batch_id -> import_batches   (so sets must go before batches)
//   import_batches.person_id     -> people           (so batches must go before people)
//   people -> workout_sessions -> workout_sets       (ON DELETE CASCADE: deleting people is
//                                                     what deletes the sets)
//
// Read together, sets have to be gone before batches, and batches before the people whose
// deletion is what removes the sets. There is no delete order that satisfies all three, so the
// stamp is CLEARED first and the batches deleted second; the workout rows themselves are then
// left for the ordinary person cascade to take, exactly as before this feature existed.
//
// The tempting "fix" is to make V55's foreign keys cascade. SQL Server will not accept that:
// workout_sets already reaches people by two paths, and a third makes it a multiple-cascade-path
// error at migration time. See V55__add_import_batch_id_constraints.sql.
@Service
public class ImportBatchCleanup {

    private final ImportBatchRepository importBatchRepository;

    public ImportBatchCleanup(ImportBatchRepository importBatchRepository) {
        this.importBatchRepository = importBatchRepository;
    }

    @Transactional
    public void deleteForAccounts(List<Long> accountIds) {
        if (accountIds.isEmpty()) {
            return;
        }
        importBatchRepository.detachSetsForAccounts(accountIds);
        importBatchRepository.detachSessionsForAccounts(accountIds);
        importBatchRepository.detachNotesForAccounts(accountIds);
        importBatchRepository.deleteByAccountIdIn(accountIds);
    }
}
