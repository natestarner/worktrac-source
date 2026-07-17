package com.worktrac.backend.exercise;

import com.worktrac.backend.account.Account;
import com.worktrac.backend.account.AccountRepository;
import com.worktrac.backend.common.ForbiddenException;
import com.worktrac.backend.common.NotFoundException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

@Service
public class ExerciseService {

    private final ExerciseRepository exerciseRepository;
    private final AccountRepository accountRepository;

    public ExerciseService(ExerciseRepository exerciseRepository, AccountRepository accountRepository) {
        this.exerciseRepository = exerciseRepository;
        this.accountRepository = accountRepository;
    }

    // The full catalog visible to this account, used for search. Grouping/favoriting is now
    // per-person (see PersonExerciseService); this is just the searchable pool.
    @Transactional(readOnly = true)
    public List<ExerciseDto> list(Long accountId) {
        return exerciseRepository.findVisibleToAccount(accountId).stream()
                .map(ExerciseDto::from)
                .toList();
    }

    @Transactional
    public ExerciseDto add(Long accountId, ExerciseRequest request) {
        Account account = accountRepository.getReferenceById(accountId);
        Exercise exercise = new Exercise(account, request.name().trim());
        syncSetupFields(exercise, request.setupFieldNamesOrEmpty());
        return ExerciseDto.from(exerciseRepository.save(exercise));
    }

    // Editing is only for an account's own exercises. Preloaded (global) exercises are shared
    // and immutable in the favorites model -- to customise one you favorite it and add your own
    // setup fields via the personalization overlay, or add your own exercise. We therefore no
    // longer fork-on-edit; a global edit attempt is rejected outright.
    @Transactional
    public ExerciseDto update(Long accountId, Long exerciseId, ExerciseRequest request) {
        Exercise exercise = requireVisibleExercise(accountId, exerciseId);
        if (exercise.isGlobal()) {
            throw new ForbiddenException("Preloaded exercises can't be edited -- favorite it, or add your own");
        }

        exercise.setName(request.name().trim());
        syncSetupFields(exercise, request.setupFieldNamesOrEmpty());
        return ExerciseDto.from(exercise);
    }

    // Deleting is only for an account's own exercises. Removing a preloaded exercise from your
    // picker is done by unfavoriting it, not by deleting the shared row.
    @Transactional
    public void remove(Long accountId, Long exerciseId) {
        Exercise exercise = requireVisibleExercise(accountId, exerciseId);
        if (exercise.isGlobal()) {
            throw new ForbiddenException("Preloaded exercises can't be deleted -- unfavorite it to remove it from your picker");
        }
        exercise.setDeleted(true);
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

    // Diffs the exercise's setup fields against the desired names, preserving existing field
    // rows (and therefore anyone's already-recorded setup values) for names that survive the
    // edit, rather than always clearing and recreating -- which would cascade-delete every
    // setup value on every edit, even a pure rename.
    private void syncSetupFields(Exercise exercise, List<String> desiredNames) {
        List<String> trimmed = desiredNames.stream()
                .map(String::trim)
                .filter(n -> !n.isEmpty())
                .toList();

        exercise.getSetupFields().removeIf(field -> !trimmed.contains(field.getName()));

        Map<String, ExerciseSetupField> existingByName = new HashMap<>();
        exercise.getSetupFields().forEach(field -> existingByName.put(field.getName(), field));

        int order = 0;
        for (String name : trimmed) {
            ExerciseSetupField existing = existingByName.get(name);
            if (existing != null) {
                existing.setSortOrder(order++);
            } else {
                exercise.getSetupFields().add(new ExerciseSetupField(exercise, name, order++));
            }
        }
    }
}
