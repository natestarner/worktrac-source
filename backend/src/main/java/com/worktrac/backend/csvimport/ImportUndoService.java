package com.worktrac.backend.csvimport;

import com.worktrac.backend.common.NotFoundException;
import com.worktrac.backend.person.Person;
import com.worktrac.backend.person.PersonService;
import com.worktrac.backend.sessionexercisenote.SessionExerciseNoteRepository;
import com.worktrac.backend.workoutsession.WorkoutSessionRepository;
import com.worktrac.backend.workoutset.WorkoutSetRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.util.List;

// Takes back what one import added.
//
// ── What it reverses, and what it deliberately does not ────────────────────────────────────────
// It deletes the batch's session notes and sets, then any session the batch CREATED that is now
// empty. A session it merely appended rows to keeps its own pre-existing sets and survives -- that
// distinction is the whole reason workout_sessions.import_batch_id is only stamped on sessions the
// import made (see CsvImportService.newSession).
//
// It does NOT revert personalization (notes, favorites, tags) and does NOT delete exercises the
// import created. Those are additive, shared with the rest of the app, and may have been built on
// since -- an exercise can have hand-logged sets against it by now, a tag can be on ten other
// exercises. Undoing them would destroy work the import never made. The confirm dialog says so in
// as many words rather than letting "undo" imply more than it does.
//
// ── Why every query is scoped by person AND batch ──────────────────────────────────────────────
// "Every row stamped with this batch belongs to this person" is an app-layer invariant with
// nothing in the schema enforcing it. A delete keyed on an unenforced invariant is one bug away
// from crossing a person boundary -- in the app whose entire product promise is that it doesn't.
// So the batch id is never the sole scope: each statement also filters on the owner, on top of
// requireOwnedPerson and the person-scoped batch lookup. Three independent barriers, and
// ImportUndoScopeTest fails if any one of them is removed.
@Service
public class ImportUndoService {

    private static final Logger log = LoggerFactory.getLogger(ImportUndoService.class);

    private final PersonService personService;
    private final ImportBatchRepository importBatchRepository;
    private final WorkoutSetRepository workoutSetRepository;
    private final WorkoutSessionRepository workoutSessionRepository;
    private final SessionExerciseNoteRepository sessionExerciseNoteRepository;
    private final Clock clock;

    public ImportUndoService(PersonService personService, ImportBatchRepository importBatchRepository,
                              WorkoutSetRepository workoutSetRepository,
                              WorkoutSessionRepository workoutSessionRepository,
                              SessionExerciseNoteRepository sessionExerciseNoteRepository, Clock clock) {
        this.personService = personService;
        this.importBatchRepository = importBatchRepository;
        this.workoutSetRepository = workoutSetRepository;
        this.workoutSessionRepository = workoutSessionRepository;
        this.sessionExerciseNoteRepository = sessionExerciseNoteRepository;
        this.clock = clock;
    }

    @Transactional(readOnly = true)
    public List<ImportBatchDto> list(Long accountId, Long personId) {
        Person person = personService.requireOwnedPerson(personId, accountId);
        return importBatchRepository.findByPerson_IdOrderByCreatedAtDesc(person.getId()).stream()
                .map(ImportBatchDto::from)
                .toList();
    }

    @Transactional
    public ImportBatchDto undo(Long accountId, Long personId, Long batchId) {
        Person person = personService.requireOwnedPerson(personId, accountId);
        ImportBatch batch = importBatchRepository.findByIdAndPerson_Id(batchId, person.getId())
                .orElseThrow(() -> new NotFoundException("No such import"));
        if (batch.isUndone()) {
            // Already reversed. Idempotent rather than an error: the rows are gone either way, and
            // a double-tap should not read as a failure.
            return ImportBatchDto.from(batch);
        }

        // Notes first: they hang off sessions this may be about to delete.
        int notes = sessionExerciseNoteRepository.deleteByImportBatchIdForPerson(batchId, person.getId());
        int sets = workoutSetRepository.deleteByImportBatchIdForPerson(batchId, person.getId());
        // Only sessions this import created, and only if nothing is left in them -- a set logged by
        // hand into an imported workout keeps that workout alive.
        int sessions = workoutSessionRepository.deleteEmptyByImportBatchIdForPerson(batchId, person.getId());

        batch.setUndoneAt(clock.instant());
        log.info("Undid import batch {} for person {}: removed {} sets, {} sessions, {} session notes",
                batchId, person.getId(), sets, sessions, notes);
        return ImportBatchDto.from(batch);
    }
}
