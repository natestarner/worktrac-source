package com.worktrac.backend.sessionexercisenote;

import com.worktrac.backend.common.NotFoundException;
import com.worktrac.backend.exercise.Exercise;
import com.worktrac.backend.exercise.ExerciseRepository;
import com.worktrac.backend.person.Person;
import com.worktrac.backend.person.PersonService;
import com.worktrac.backend.workoutsession.WorkoutSession;
import com.worktrac.backend.workoutsession.WorkoutSessionRepository;
import com.worktrac.backend.workoutsession.WorkoutSessionService;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.Optional;

@Service
public class SessionExerciseNoteService {

    private final SessionExerciseNoteRepository sessionExerciseNoteRepository;
    private final WorkoutSessionRepository workoutSessionRepository;
    private final WorkoutSessionService workoutSessionService;
    private final ExerciseRepository exerciseRepository;
    private final PersonService personService;

    public SessionExerciseNoteService(SessionExerciseNoteRepository sessionExerciseNoteRepository,
                                       WorkoutSessionRepository workoutSessionRepository,
                                       WorkoutSessionService workoutSessionService,
                                       ExerciseRepository exerciseRepository,
                                       PersonService personService) {
        this.sessionExerciseNoteRepository = sessionExerciseNoteRepository;
        this.workoutSessionRepository = workoutSessionRepository;
        this.workoutSessionService = workoutSessionService;
        this.exerciseRepository = exerciseRepository;
        this.personService = personService;
    }

    // Live path: saving a note before any set has been logged must still materialize a
    // live session -- otherwise there is nothing to key the note on yet -- exactly like
    // WorkoutSetService.logLiveSet does for the first set of a workout.
    @Transactional
    public SessionExerciseNoteDto upsertLiveNote(Long accountId, Long personId, Long exerciseId, String note) {
        Person person = personService.requireOwnedPerson(personId, accountId);
        Exercise exercise = requireVisibleExercise(accountId, exerciseId);
        WorkoutSession session = workoutSessionService.getOrCreateLiveSession(person);
        return upsert(session, exercise, note);
    }

    // Editing an explicit (typically past) session -- no personId in the path, ownership
    // enforced via session -> person -> account, matching
    // WorkoutSetService.logSetIntoSession.
    @Transactional
    public SessionExerciseNoteDto upsertSessionNote(Long accountId, Long sessionId, Long exerciseId, String note) {
        WorkoutSession session = workoutSessionRepository.findByIdAndPerson_Account_Id(sessionId, accountId)
                .orElseThrow(() -> new NotFoundException("No such session"));
        Exercise exercise = requireVisibleExercise(accountId, exerciseId);
        return upsert(session, exercise, note);
    }

    @Transactional(readOnly = true)
    public Optional<SessionExerciseNoteDto> getNote(Long accountId, Long sessionId, Long exerciseId) {
        workoutSessionRepository.findByIdAndPerson_Account_Id(sessionId, accountId)
                .orElseThrow(() -> new NotFoundException("No such session"));
        return sessionExerciseNoteRepository.findBySession_IdAndExercise_Id(sessionId, exerciseId)
                .map(n -> new SessionExerciseNoteDto(sessionId, exerciseId, n.getNote()));
    }

    // A blank note clears it -- deletes the row rather than storing an empty string, so
    // "has a note" can be tested by row presence alone.
    private SessionExerciseNoteDto upsert(WorkoutSession session, Exercise exercise, String note) {
        String trimmed = note == null ? "" : note.trim();
        Optional<SessionExerciseNote> existing =
                sessionExerciseNoteRepository.findBySession_IdAndExercise_Id(session.getId(), exercise.getId());

        if (trimmed.isEmpty()) {
            existing.ifPresent(sessionExerciseNoteRepository::delete);
            return new SessionExerciseNoteDto(session.getId(), exercise.getId(), null);
        }

        if (existing.isPresent()) {
            existing.get().setNote(trimmed);
        } else {
            sessionExerciseNoteRepository.save(new SessionExerciseNote(session, exercise, trimmed));
        }
        return new SessionExerciseNoteDto(session.getId(), exercise.getId(), trimmed);
    }

    private Exercise requireVisibleExercise(Long accountId, Long exerciseId) {
        Exercise exercise = exerciseRepository.findById(exerciseId)
                .orElseThrow(() -> new NotFoundException("No such exercise"));
        boolean visible = exercise.isGlobal() || exercise.getAccount().getId().equals(accountId);
        if (!visible) {
            throw new NotFoundException("No such exercise");
        }
        return exercise;
    }
}
