package com.worktrac.backend.exercise;

import com.worktrac.backend.common.NotFoundException;
import com.worktrac.backend.person.Person;
import com.worktrac.backend.person.PersonService;
import com.worktrac.backend.personcategory.PersonCategory;
import com.worktrac.backend.personcategory.PersonCategoryRepository;
import com.worktrac.backend.workoutset.WorkoutSetRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

// Everything that is "this person's relationship to an exercise": their Log-picker list
// (favorites UNION logged), favoriting, filing into their own categories, and the custom
// setup-field overlay. None of it mutates the shared Exercise row.
@Service
public class PersonExerciseService {

    private final PersonExerciseRepository personExerciseRepository;
    private final PersonExerciseFieldRepository personExerciseFieldRepository;
    private final PersonCategoryRepository personCategoryRepository;
    private final ExerciseRepository exerciseRepository;
    private final WorkoutSetRepository workoutSetRepository;
    private final PersonService personService;

    public PersonExerciseService(PersonExerciseRepository personExerciseRepository,
                                  PersonExerciseFieldRepository personExerciseFieldRepository,
                                  PersonCategoryRepository personCategoryRepository,
                                  ExerciseRepository exerciseRepository,
                                  WorkoutSetRepository workoutSetRepository,
                                  PersonService personService) {
        this.personExerciseRepository = personExerciseRepository;
        this.personExerciseFieldRepository = personExerciseFieldRepository;
        this.personCategoryRepository = personCategoryRepository;
        this.exerciseRepository = exerciseRepository;
        this.workoutSetRepository = workoutSetRepository;
        this.personService = personService;
    }

    // The person's Log picker: every exercise they've favorited or logged a set for, carrying
    // their personalization. Anything else in the catalog is reachable only via search.
    @Transactional(readOnly = true)
    public List<PersonExerciseDto> listForPerson(Long accountId, Long personId) {
        Person person = personService.requireOwnedPerson(personId, accountId);

        Map<Long, PersonExercise> byExerciseId = new HashMap<>();
        Set<Long> pickerIds = new HashSet<>();
        for (PersonExercise pe : personExerciseRepository.findByPerson_Id(person.getId())) {
            Long exId = pe.getExercise().getId();
            byExerciseId.put(exId, pe);
            if (pe.isFavorite()) {
                pickerIds.add(exId);
            }
        }
        pickerIds.addAll(workoutSetRepository.findDistinctExerciseIdsByPerson(person.getId()));
        if (pickerIds.isEmpty()) {
            return List.of();
        }

        return exerciseRepository.findAllById(pickerIds).stream()
                .filter(ex -> !ex.isDeleted())
                .filter(ex -> ex.isGlobal() || ex.getAccount().getId().equals(accountId))
                .sorted(Comparator.comparing(Exercise::getName, String.CASE_INSENSITIVE_ORDER))
                .map(ex -> PersonExerciseDto.of(ex, byExerciseId.get(ex.getId())))
                .toList();
    }

    @Transactional
    public PersonExerciseDto setFavorite(Long accountId, Long personId, Long exerciseId, boolean favorite) {
        Person person = personService.requireOwnedPerson(personId, accountId);
        Exercise exercise = requireVisibleExercise(accountId, exerciseId);
        PersonExercise pe = getOrCreate(person, exercise);
        pe.setFavorite(favorite);
        return PersonExerciseDto.of(exercise, pe);
    }

    @Transactional
    public PersonExerciseDto setCategory(Long accountId, Long personId, Long exerciseId, Long personCategoryId) {
        Person person = personService.requireOwnedPerson(personId, accountId);
        Exercise exercise = requireVisibleExercise(accountId, exerciseId);
        PersonCategory category = null;
        if (personCategoryId != null) {
            category = personCategoryRepository.findByIdAndPerson_Id(personCategoryId, person.getId())
                    .orElseThrow(() -> new NotFoundException("No such category"));
        }
        PersonExercise pe = getOrCreate(person, exercise);
        pe.setCategory(category);
        return PersonExerciseDto.of(exercise, pe);
    }

    // Auto-favorite hook for when an exercise is added to a routine (called from
    // RoutineService with an already-resolved, already-owned person/exercise).
    @Transactional
    public void ensureFavorite(Person person, Exercise exercise) {
        PersonExercise pe = getOrCreate(person, exercise);
        if (!pe.isFavorite()) {
            pe.setFavorite(true);
        }
    }

    @Transactional(readOnly = true)
    public List<PersonExerciseFieldDto> listCustomFields(Long accountId, Long personId, Long exerciseId) {
        Person person = personService.requireOwnedPerson(personId, accountId);
        requireVisibleExercise(accountId, exerciseId);
        return personExerciseRepository.findByPerson_IdAndExercise_Id(person.getId(), exerciseId)
                .map(pe -> personExerciseFieldRepository.findByPersonExercise_IdOrderBySortOrderAsc(pe.getId()).stream()
                        .map(PersonExerciseFieldDto::from)
                        .toList())
                .orElse(List.of());
    }

    @Transactional
    public PersonExerciseFieldDto addCustomField(Long accountId, Long personId, Long exerciseId, String name) {
        if (name == null || name.trim().isEmpty()) {
            throw new IllegalArgumentException("Field name must not be blank");
        }
        Person person = personService.requireOwnedPerson(personId, accountId);
        Exercise exercise = requireVisibleExercise(accountId, exerciseId);
        PersonExercise pe = getOrCreate(person, exercise);
        int nextOrder = personExerciseFieldRepository.findByPersonExercise_IdOrderBySortOrderAsc(pe.getId()).size();
        PersonExerciseField field = personExerciseFieldRepository.save(new PersonExerciseField(pe, name.trim(), nextOrder));
        return PersonExerciseFieldDto.from(field);
    }

    @Transactional
    public PersonExerciseFieldDto updateCustomField(Long accountId, Long personId, Long exerciseId, Long fieldId,
                                                     String name, String value) {
        Person person = personService.requireOwnedPerson(personId, accountId);
        requireVisibleExercise(accountId, exerciseId);
        PersonExerciseField field = requireField(person, exerciseId, fieldId);
        if (name != null && !name.trim().isEmpty()) {
            field.setName(name.trim());
        }
        if (value != null) {
            field.setValue(value.trim());
        }
        return PersonExerciseFieldDto.from(field);
    }

    @Transactional
    public void deleteCustomField(Long accountId, Long personId, Long exerciseId, Long fieldId) {
        Person person = personService.requireOwnedPerson(personId, accountId);
        requireVisibleExercise(accountId, exerciseId);
        personExerciseFieldRepository.delete(requireField(person, exerciseId, fieldId));
    }

    private PersonExerciseField requireField(Person person, Long exerciseId, Long fieldId) {
        PersonExercise pe = personExerciseRepository.findByPerson_IdAndExercise_Id(person.getId(), exerciseId)
                .orElseThrow(() -> new NotFoundException("No such custom field"));
        return personExerciseFieldRepository.findByIdAndPersonExercise_Id(fieldId, pe.getId())
                .orElseThrow(() -> new NotFoundException("No such custom field"));
    }

    private PersonExercise getOrCreate(Person person, Exercise exercise) {
        return personExerciseRepository.findByPerson_IdAndExercise_Id(person.getId(), exercise.getId())
                .orElseGet(() -> personExerciseRepository.save(new PersonExercise(person, exercise)));
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
