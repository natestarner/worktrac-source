package com.worktrac.backend.exercise;

import com.worktrac.backend.account.Account;
import com.worktrac.backend.account.AccountRepository;
import com.worktrac.backend.category.Category;
import com.worktrac.backend.category.CategoryRepository;
import com.worktrac.backend.common.NotFoundException;
import com.worktrac.backend.person.Person;
import com.worktrac.backend.person.PersonRepository;
import com.worktrac.backend.routine.RoutineExerciseRepository;
import com.worktrac.backend.setupvalue.SetupValue;
import com.worktrac.backend.setupvalue.SetupValueRepository;
import com.worktrac.backend.workoutset.WorkoutSetRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

@Service
public class ExerciseService {

    private final ExerciseRepository exerciseRepository;
    private final CategoryRepository categoryRepository;
    private final AccountRepository accountRepository;
    private final PersonRepository personRepository;
    private final WorkoutSetRepository workoutSetRepository;
    private final RoutineExerciseRepository routineExerciseRepository;
    private final SetupValueRepository setupValueRepository;

    public ExerciseService(ExerciseRepository exerciseRepository, CategoryRepository categoryRepository,
                            AccountRepository accountRepository, PersonRepository personRepository,
                            WorkoutSetRepository workoutSetRepository, RoutineExerciseRepository routineExerciseRepository,
                            SetupValueRepository setupValueRepository) {
        this.exerciseRepository = exerciseRepository;
        this.categoryRepository = categoryRepository;
        this.accountRepository = accountRepository;
        this.personRepository = personRepository;
        this.workoutSetRepository = workoutSetRepository;
        this.routineExerciseRepository = routineExerciseRepository;
        this.setupValueRepository = setupValueRepository;
    }

    @Transactional(readOnly = true)
    public List<ExerciseDto> list(Long accountId) {
        return exerciseRepository.findVisibleToAccount(accountId).stream()
                .map(ExerciseDto::from)
                .toList();
    }

    @Transactional
    public ExerciseDto add(Long accountId, ExerciseRequest request) {
        Account account = accountRepository.getReferenceById(accountId);
        Category category = requireVisibleCategory(accountId, request.categoryId());

        Exercise exercise = new Exercise(account, category, request.name().trim());
        syncSetupFields(exercise, request.setupFieldNamesOrEmpty());
        return ExerciseDto.from(exerciseRepository.save(exercise));
    }

    // Editing an account's own exercise updates it in place. Editing a shared system
    // exercise instead forks it into an account-owned copy on first touch (see
    // forkForAccount) -- the original stays exactly as every other household sees it.
    @Transactional
    public ExerciseDto update(Long accountId, Long exerciseId, ExerciseRequest request) {
        Exercise exercise = requireVisibleExercise(accountId, exerciseId);
        Category category = requireVisibleCategory(accountId, request.categoryId());

        if (exercise.isGlobal()) {
            Exercise forked = forkForAccount(accountId, exercise, request.name().trim(), category, request.setupFieldNamesOrEmpty());
            return ExerciseDto.from(forked);
        }

        exercise.setName(request.name().trim());
        exercise.setCategory(category);
        syncSetupFields(exercise, request.setupFieldNamesOrEmpty());
        return ExerciseDto.from(exercise);
    }

    // Deleting an account's own exercise soft-deletes it in place. Deleting a shared
    // system exercise forks an exact copy for this account only and soft-deletes the
    // fork -- history stays intact for this household, every other household keeps
    // seeing the original untouched.
    @Transactional
    public void remove(Long accountId, Long exerciseId) {
        Exercise exercise = requireVisibleExercise(accountId, exerciseId);

        if (exercise.isGlobal()) {
            List<String> fieldNames = exercise.getSetupFields().stream().map(ExerciseSetupField::getName).toList();
            Exercise forked = forkForAccount(accountId, exercise, exercise.getName(), exercise.getCategory(), fieldNames);
            forked.setDeleted(true);
            return;
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

    private Exercise forkForAccount(Long accountId, Exercise original, String name, Category category, List<String> setupFieldNames) {
        Account account = accountRepository.getReferenceById(accountId);
        Exercise forked = new Exercise(account, category, name);
        forked.setForkedFrom(original);
        syncSetupFields(forked, setupFieldNames);
        exerciseRepository.save(forked);

        List<Long> personIds = personRepository.findByAccount_IdOrderByCreatedAtAsc(accountId).stream()
                .map(Person::getId)
                .toList();
        if (personIds.isEmpty()) {
            return forked;
        }

        workoutSetRepository.findByPerson_IdInAndExercise_Id(personIds, original.getId())
                .forEach(set -> set.setExercise(forked));
        routineExerciseRepository.findByExercise_IdAndRoutine_Person_IdIn(original.getId(), personIds)
                .forEach(routineExercise -> routineExercise.setExercise(forked));

        Map<String, ExerciseSetupField> forkedFieldsByName = new HashMap<>();
        forked.getSetupFields().forEach(field -> forkedFieldsByName.put(field.getName(), field));

        for (ExerciseSetupField originalField : original.getSetupFields()) {
            ExerciseSetupField matching = forkedFieldsByName.get(originalField.getName());
            List<SetupValue> values = setupValueRepository.findByField_IdAndPerson_IdIn(originalField.getId(), personIds);
            for (SetupValue value : values) {
                if (matching != null) {
                    value.setField(matching);
                } else {
                    // The field was dropped as part of this edit -- its recorded
                    // values for this account no longer apply to anything.
                    setupValueRepository.delete(value);
                }
            }
        }

        return forked;
    }

    // Diffs the exercise's setup fields against the desired names, preserving
    // existing field rows (and therefore anyone's already-recorded setup values) for
    // names that survive the edit, rather than always clearing and recreating --
    // which would cascade-delete every setup value on every edit, even a pure rename.
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

    private Category requireVisibleCategory(Long accountId, Long categoryId) {
        Category category = categoryRepository.findById(categoryId)
                .orElseThrow(() -> new NotFoundException("No such category"));
        boolean visible = category.isGlobal() || category.getAccount().getId().equals(accountId);
        if (!visible) {
            throw new NotFoundException("No such category");
        }
        return category;
    }
}
