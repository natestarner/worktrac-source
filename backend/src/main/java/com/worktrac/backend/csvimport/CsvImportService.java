package com.worktrac.backend.csvimport;

import com.worktrac.backend.account.Account;
import com.worktrac.backend.account.AccountRepository;
import com.worktrac.backend.exercise.Exercise;
import com.worktrac.backend.exercise.ExerciseRepository;
import com.worktrac.backend.exercise.PersonExerciseService;
import com.worktrac.backend.export.ExportRow;
import com.worktrac.backend.export.WorkoutRowProjection;
import com.worktrac.backend.person.Person;
import com.worktrac.backend.person.PersonService;
import com.worktrac.backend.quota.QuotaService;
import com.worktrac.backend.sessionexercisenote.SessionExerciseNote;
import com.worktrac.backend.sessionexercisenote.SessionExerciseNoteRepository;
import com.worktrac.backend.user.User;
import com.worktrac.backend.user.UserRepository;
import com.worktrac.backend.workoutsession.WorkoutSession;
import com.worktrac.backend.workoutsession.WorkoutSessionRepository;
import com.worktrac.backend.workoutset.WorkoutSet;
import com.worktrac.backend.workoutset.WorkoutSetRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

// Reads an export-shaped CSV back into one person's history.
//
// The design turns on one idea: import is the inverse of export, so "do we already have this row?"
// is answered by projecting the person's existing data through the SAME derivation the exporter
// uses (WorkoutRowProjection) and comparing row against row. Nothing else has to agree about what
// a set is, and the two halves cannot drift apart.
//
// Three things worth knowing before changing anything here:
//
//   - Duplicate detection does NOT use client_key. A set logged in the app carries a UUID the CSV
//     never saw, so a key-based scheme would fail on the most likely case of all -- re-importing
//     into the same account. Imported sets are written with a null client_key, like every other
//     historical row.
//
//   - Because duplicates are recomputed against live data at commit time, the operation is
//     idempotent. A commit that times out client-side but succeeded server-side is safe to retry:
//     the retry sees everything as a duplicate. That is the direct answer to
//     docs/incidents/2026-08-01-email-blind-spots-and-delete-timeout.md, where the client giving
//     up did not stop the transaction behind it.
//
//   - What it cannot catch is two commits of the same file racing each other: under RCSI both read
//     a clean slate and both insert. The guard is the UI disabling the button while a commit is in
//     flight; the recovery is undo.
//
// PR detection is deliberately skipped. WorkoutSetService.insertSetAndDetectPr runs two StatsService
// queries per set for an isPR flag used only by the celebration overlay -- History, PRs and Trends
// all derive records on read. Skipping it removes most of the query volume and avoids the
// read-then-write pattern on workout_sets that deadlocked under load
// (docs/incidents/2026-08-13-e2e-parallel-flakiness.md).
@Service
public class CsvImportService {

    private static final Logger log = LoggerFactory.getLogger(CsvImportService.class);

    // Flushed in chunks so a large file doesn't build one enormous persistence context. The row
    // cap in CsvImportParser is what actually bounds the transaction; this keeps memory flat.
    private static final int BATCH_SIZE = 500;

    private final PersonService personService;
    private final CsvImportParser csvImportParser;
    private final WorkoutRowProjection workoutRowProjection;
    private final ExerciseRepository exerciseRepository;
    private final AccountRepository accountRepository;
    private final UserRepository userRepository;
    private final WorkoutSessionRepository workoutSessionRepository;
    private final WorkoutSetRepository workoutSetRepository;
    private final SessionExerciseNoteRepository sessionExerciseNoteRepository;
    private final PersonExerciseService personExerciseService;
    private final ImportBatchRepository importBatchRepository;
    private final QuotaService quotaService;
    private final Clock clock;

    public CsvImportService(PersonService personService, CsvImportParser csvImportParser,
                             WorkoutRowProjection workoutRowProjection, ExerciseRepository exerciseRepository,
                             AccountRepository accountRepository, UserRepository userRepository,
                             WorkoutSessionRepository workoutSessionRepository,
                             WorkoutSetRepository workoutSetRepository,
                             SessionExerciseNoteRepository sessionExerciseNoteRepository,
                             PersonExerciseService personExerciseService,
                             ImportBatchRepository importBatchRepository, QuotaService quotaService, Clock clock) {
        this.personService = personService;
        this.csvImportParser = csvImportParser;
        this.workoutRowProjection = workoutRowProjection;
        this.exerciseRepository = exerciseRepository;
        this.accountRepository = accountRepository;
        this.userRepository = userRepository;
        this.workoutSessionRepository = workoutSessionRepository;
        this.workoutSetRepository = workoutSetRepository;
        this.sessionExerciseNoteRepository = sessionExerciseNoteRepository;
        this.personExerciseService = personExerciseService;
        this.importBatchRepository = importBatchRepository;
        this.quotaService = quotaService;
        this.clock = clock;
    }

    @Transactional(readOnly = true)
    public ImportPreviewDto preview(Long accountId, Long personId, ImportRequest request) {
        Person person = personService.requireOwnedPerson(personId, accountId);
        Account account = accountRepository.getReferenceById(accountId);
        Plan plan = plan(accountId, person, account, request);
        return plan.summarize(null, 0, 0, 0, 0, List.of(), 0);
    }

    @Transactional
    public ImportPreviewDto commit(Long accountId, Long userId, Long personId, ImportRequest request) {
        Person person = personService.requireOwnedPerson(personId, accountId);
        Account account = accountRepository.getReferenceById(accountId);
        Plan plan = plan(accountId, person, account, request);

        if (plan.totalSets() == 0) {
            // Nothing to record, and deliberately no batch row: a retried commit that finds
            // everything already present would otherwise leave a phantom empty entry in the
            // person's import history.
            return plan.summarize(null, 0, 0, 0, 0, List.of(), 0);
        }

        // Import is the only vector that can add rows in bulk, so it is the only place the
        // per-account sets ceiling is enforced -- logging a set by hand is bounded by physiology,
        // and refusing one would discard a durable write recording a workout somebody actually
        // did. Checked against the whole planned batch, so one file cannot vault the ceiling in a
        // single transaction.
        quotaService.requireSetCapacity(accountId, workoutSetRepository.countByAccountId(accountId),
                plan.totalSets());

        User user = userRepository.getReferenceById(userId);
        ImportBatch batch = importBatchRepository.save(new ImportBatch(person, user, request.filename(),
                plan.totalSets(), plan.createdSessionCount(), plan.skippedDuplicates(), clock.instant()));

        Written written = write(plan, person, account, accountId, batch);

        log.info("Imported {} sets into {} new and {} existing workouts for person {} (batch {}); "
                        + "{} rows were already present",
                plan.totalSets(), plan.createdSessionCount(), plan.appendedSessionCount(), person.getId(),
                batch.getId(), plan.skippedDuplicates());

        return plan.summarize(batch.getId(), written.notesApplied, written.notesSkipped, written.favoritesApplied,
                written.tagsApplied, written.newTagNames, written.sessionNotesApplied);
    }

    // ── Planning: everything decided before a single row is written ────────────────────────────

    // Preview and commit both run this, so the numbers someone confirms are produced by the very
    // code that then acts on them -- there is no second implementation to disagree.
    private Plan plan(Long accountId, Person person, Account account, ImportRequest request) {
        ParsedImport parsed = csvImportParser.parse(request.csv(), account.getDefaultUnit());

        // One query for the whole visible catalog, matched case-insensitively on the trimmed name,
        // exactly as ExerciseService.add does. That query already orders the account's own rows
        // before global ones, so first-wins here means what it means there.
        Map<String, Exercise> existingByName = new HashMap<>();
        for (Exercise exercise : exerciseRepository.findVisibleToAccount(accountId)) {
            existingByName.putIfAbsent(key(exercise.getName()), exercise);
        }

        List<ImportRowError> errors = new ArrayList<>(parsed.rowErrors());
        Map<String, MeasureUse> measures = measuresByExercise(parsed);
        Set<String> unusable = new LinkedHashSet<>();
        Set<String> newExerciseNames = new LinkedHashSet<>();

        for (Map.Entry<String, MeasureUse> entry : measures.entrySet()) {
            MeasureUse use = entry.getValue();
            if (use.holds() > 0 && use.reps() > 0) {
                unusable.add(entry.getKey());
                errors.add(new ImportRowError(use.firstLine(), "\"" + use.displayName()
                        + "\" appears with both reps and durations. An exercise is measured one way or the other."));
                continue;
            }
            Exercise existing = existingByName.get(entry.getKey());
            if (existing == null) {
                newExerciseNames.add(use.displayName());
            } else if (existing.isDurationTracked() != (use.holds() > 0)) {
                unusable.add(entry.getKey());
                errors.add(new ImportRowError(use.firstLine(), "\"" + use.displayName() + "\" is already tracked in "
                        + (existing.isDurationTracked() ? "seconds" : "reps")
                        + " here, but this file records it the other way."));
            }
        }

        // What the person already has, as a multiset keyed on the identity of an exported row.
        // A multiset rather than a set because two genuinely distinct identical sets can share a
        // timestamp: if the file has two and the person has one, the honest answer is to add one,
        // not to skip both.
        Map<ExportRow.Identity, Integer> remaining = new HashMap<>();
        Map<ExportRow.Identity, Long> sessionOfIdentity = new HashMap<>();
        for (ExportRow row : workoutRowProjection.project(person)) {
            remaining.merge(row.identity(), 1, Integer::sum);
            sessionOfIdentity.putIfAbsent(row.identity(), row.sessionId());
        }

        List<PlannedSession> planned = new ArrayList<>();
        int skipped = 0;

        for (ParsedImport.ParsedSession session : parsed.sessions()) {
            List<ParsedImport.ParsedRow> keep = new ArrayList<>();
            Map<Long, Integer> matchedSessions = new HashMap<>();

            for (ParsedImport.ParsedRow row : session.rows()) {
                if (unusable.contains(key(row.exerciseName()))) {
                    continue;
                }
                Exercise exercise = existingByName.get(key(row.exerciseName()));
                // An exercise this import is about to create cannot have existing sets, so those
                // rows are never duplicates and need no lookup.
                if (exercise != null) {
                    ExportRow.Identity identity = identityOf(row, exercise);
                    Integer available = remaining.get(identity);
                    if (available != null && available > 0) {
                        remaining.put(identity, available - 1);
                        skipped++;
                        Long sessionId = sessionOfIdentity.get(identity);
                        if (sessionId != null) {
                            matchedSessions.merge(sessionId, 1, Integer::sum);
                        }
                        continue;
                    }
                }
                keep.add(row);
            }

            if (keep.isEmpty()) {
                continue;
            }
            // A group whose duplicates all sit in one existing workout is plainly part of that
            // workout: its new rows are appended there rather than forking a second session on the
            // same day. Duplicates spread over several sessions only happens with a hand-mangled
            // file; the one holding the most matches is the best available answer.
            Long appendTo = matchedSessions.entrySet().stream()
                    .max(Map.Entry.comparingByValue())
                    .map(Map.Entry::getKey)
                    .orElse(null);
            planned.add(new PlannedSession(session, keep, appendTo));
        }

        return new Plan(planned, skipped, List.copyOf(newExerciseNames), errors, parsed);
    }

    private Map<String, MeasureUse> measuresByExercise(ParsedImport parsed) {
        Map<String, MeasureUse> measures = new LinkedHashMap<>();
        for (ParsedImport.ParsedSession session : parsed.sessions()) {
            for (ParsedImport.ParsedRow row : session.rows()) {
                measures.compute(key(row.exerciseName()), (k, existing) -> existing == null
                        ? MeasureUse.first(row.exerciseName(), row.line(), row.isHold())
                        : existing.plus(row.isHold()));
            }
        }
        return measures;
    }

    private ExportRow.Identity identityOf(ParsedImport.ParsedRow row, Exercise exercise) {
        return new ExportRow.Identity(exercise.getId(), ExportRow.normalizeInstant(row.createdAt()),
                ExportRow.normalizeWeight(row.weight()), row.unit(), row.reps(), row.durationSeconds());
    }

    // ── Writing ────────────────────────────────────────────────────────────────────────────────

    private Written write(Plan plan, Person person, Account account, Long accountId, ImportBatch batch) {
        Map<String, Exercise> byName = new HashMap<>();
        for (Exercise exercise : exerciseRepository.findVisibleToAccount(accountId)) {
            byName.putIfAbsent(key(exercise.getName()), exercise);
        }

        // Personalization is per (person, exercise), not per session, so it is collected across the
        // whole file and applied once -- otherwise an exercise appearing in ten workouts would be
        // reconciled ten times.
        Map<String, Personalization> personalization = new LinkedHashMap<>();
        List<WorkoutSet> pending = new ArrayList<>();
        int sessionNotesApplied = 0;

        for (PlannedSession planned : plan.sessions()) {
            WorkoutSession session = planned.appendToSessionId() != null
                    ? workoutSessionRepository.getReferenceById(planned.appendToSessionId())
                    : workoutSessionRepository.save(newSession(person, planned, batch));

            Map<Long, Exercise> exercisesInSession = new LinkedHashMap<>();
            Map<Long, String> sessionNotes = new LinkedHashMap<>();

            for (ParsedImport.ParsedRow row : planned.rows()) {
                Exercise exercise = byName.computeIfAbsent(key(row.exerciseName()),
                        k -> exerciseRepository.save(new Exercise(account, row.exerciseName(), null,
                                row.isHold() ? Exercise.TRACKING_TYPE_DURATION : Exercise.TRACKING_TYPE_STRENGTH)));

                WorkoutSet set = new WorkoutSet(session, person, exercise, row.weight(), row.reps(),
                        row.durationSeconds(), row.unit(), row.restSeconds(), row.createdAt(), null);
                set.setImportBatchId(batch.getId());
                pending.add(set);
                if (pending.size() >= BATCH_SIZE) {
                    flush(pending);
                }

                exercisesInSession.putIfAbsent(exercise.getId(), exercise);
                if (row.sessionNote() != null) {
                    sessionNotes.putIfAbsent(exercise.getId(), row.sessionNote());
                }
                personalization.computeIfAbsent(key(row.exerciseName()), k -> new Personalization(exercise))
                        .absorb(row);
            }

            for (Map.Entry<Long, String> note : sessionNotes.entrySet()) {
                Exercise exercise = exercisesInSession.get(note.getKey());
                // Never overwrite: a note already on this workout was written by the person, and
                // the file cannot know it was replaced since.
                if (sessionExerciseNoteRepository
                        .findBySession_IdAndExercise_Id(session.getId(), exercise.getId()).isPresent()) {
                    continue;
                }
                SessionExerciseNote saved = sessionExerciseNoteRepository.save(
                        new SessionExerciseNote(session, exercise, note.getValue()));
                saved.setImportBatchId(batch.getId());
                sessionNotesApplied++;
            }
        }
        flush(pending);

        Written written = new Written();
        written.sessionNotesApplied = sessionNotesApplied;
        for (Personalization p : personalization.values()) {
            if (!p.hasAnything()) {
                continue;
            }
            var applied = personExerciseService.applyImportedPersonalization(accountId, person, p.exercise,
                    p.note, p.favorite, List.copyOf(p.tags));
            if (applied.noteApplied()) {
                written.notesApplied++;
            }
            if (applied.noteSkipped()) {
                written.notesSkipped++;
            }
            if (applied.favoriteApplied()) {
                written.favoritesApplied++;
            }
            written.tagsApplied += applied.tagsAdded();
            written.newTagNames.addAll(applied.newTagNames());
        }
        return written;
    }

    private void flush(List<WorkoutSet> pending) {
        if (pending.isEmpty()) {
            return;
        }
        workoutSetRepository.saveAll(pending);
        pending.clear();
    }

    // ⚠️ endedAt is never left null. WorkoutSessionService.getLiveSession takes the person's first
    // session with a null endedAt, so an imported 2019 workout with an open end would become their
    // live session and quietly swallow the next set they logged.
    private WorkoutSession newSession(Person person, PlannedSession planned, ImportBatch batch) {
        WorkoutSession session = new WorkoutSession(person, planned.source().startedAt(), planned.source().manual());
        session.setEndedAt(planned.source().endedAt());
        session.setLastActivityAt(planned.source().endedAt());
        // Only a session the import CREATED carries the stamp. One it merely appended to must not,
        // or undo would delete a workout that was already there.
        session.setImportBatchId(batch.getId());
        return session;
    }

    private String key(String exerciseName) {
        return exerciseName.trim().toLowerCase(Locale.ROOT);
    }

    // ── Internal shapes ────────────────────────────────────────────────────────────────────────

    private record PlannedSession(ParsedImport.ParsedSession source, List<ParsedImport.ParsedRow> rows,
                                   Long appendToSessionId) {
    }

    private record Plan(List<PlannedSession> sessions, int skippedDuplicates, List<String> newExerciseNames,
                         List<ImportRowError> rowErrors, ParsedImport parsed) {

        int totalSets() {
            return sessions.stream().mapToInt(s -> s.rows().size()).sum();
        }

        int createdSessionCount() {
            return (int) sessions.stream().filter(s -> s.appendToSessionId() == null).count();
        }

        int appendedSessionCount() {
            return (int) sessions.stream().filter(s -> s.appendToSessionId() != null).count();
        }

        ImportPreviewDto summarize(Long batchId, int notesApplied, int notesSkipped, int favoritesApplied,
                                    int tagsApplied, List<String> newTagNames, int sessionNotesApplied) {
            List<ImportRowError> sorted = rowErrors.stream()
                    .sorted(Comparator.comparingInt(ImportRowError::line))
                    .toList();
            return new ImportPreviewDto(batchId, sessions.size(), totalSets(), skippedDuplicates,
                    newExerciseNames, notesApplied, notesSkipped, favoritesApplied, tagsApplied,
                    newTagNames, sessionNotesApplied, parsed.appliedDefaults(), parsed.ignoredColumns(), sorted);
        }
    }

    // How a file measures one exercise, and where it first said so.
    private record MeasureUse(String displayName, int firstLine, int holds, int reps) {
        static MeasureUse first(String displayName, int line, boolean hold) {
            return new MeasureUse(displayName, line, hold ? 1 : 0, hold ? 0 : 1);
        }

        MeasureUse plus(boolean hold) {
            return new MeasureUse(displayName, firstLine, holds + (hold ? 1 : 0), reps + (hold ? 0 : 1));
        }
    }

    private static class Personalization {
        private final Exercise exercise;
        private String note;
        private boolean favorite;
        private final Set<String> tags = new LinkedHashSet<>();

        Personalization(Exercise exercise) {
            this.exercise = exercise;
        }

        // These columns repeat on every row for an exercise, so the last non-blank note wins and
        // any single row marking it a favorite is enough.
        void absorb(ParsedImport.ParsedRow row) {
            if (row.exerciseNote() != null) {
                note = row.exerciseNote();
            }
            favorite |= row.favorite();
            tags.addAll(row.tags());
        }

        boolean hasAnything() {
            return note != null || favorite || !tags.isEmpty();
        }
    }

    private static class Written {
        private int notesApplied;
        private int notesSkipped;
        private int favoritesApplied;
        private int tagsApplied;
        private int sessionNotesApplied;
        private final List<String> newTagNames = new ArrayList<>();
    }
}
