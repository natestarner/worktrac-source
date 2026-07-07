package com.worktrac.backend.setupvalue;

import com.worktrac.backend.common.NotFoundException;
import com.worktrac.backend.exercise.Exercise;
import com.worktrac.backend.exercise.ExerciseRepository;
import com.worktrac.backend.exercise.ExerciseSetupField;
import com.worktrac.backend.exercise.ExerciseSetupFieldRepository;
import com.worktrac.backend.person.Person;
import com.worktrac.backend.person.PersonService;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

@Service
public class SetupValueService {

    private final SetupValueRepository setupValueRepository;
    private final ExerciseSetupFieldRepository fieldRepository;
    private final ExerciseRepository exerciseRepository;
    private final PersonService personService;

    public SetupValueService(SetupValueRepository setupValueRepository, ExerciseSetupFieldRepository fieldRepository,
                              ExerciseRepository exerciseRepository, PersonService personService) {
        this.setupValueRepository = setupValueRepository;
        this.fieldRepository = fieldRepository;
        this.exerciseRepository = exerciseRepository;
        this.personService = personService;
    }

    // Only returns fields this person has actually set a value for -- the frontend
    // cross-references against the exercise's full setupFields list (from GET
    // /api/exercises) to know which fields are still unset ("Tap to set").
    @Transactional(readOnly = true)
    public List<SetupValueDto> list(Long accountId, Long personId, Long exerciseId) {
        Person person = personService.requireOwnedPerson(personId, accountId);
        requireVisibleExercise(accountId, exerciseId);
        return setupValueRepository.findByPerson_IdAndField_Exercise_Id(person.getId(), exerciseId).stream()
                .map(SetupValueDto::from)
                .toList();
    }

    @Transactional
    public SetupValueDto upsert(Long accountId, Long personId, Long exerciseId, Long fieldId, String value) {
        Person person = personService.requireOwnedPerson(personId, accountId);
        requireVisibleExercise(accountId, exerciseId);
        ExerciseSetupField field = fieldRepository.findByIdAndExercise_Id(fieldId, exerciseId)
                .orElseThrow(() -> new NotFoundException("No such setup field for that exercise"));

        SetupValue setupValue = setupValueRepository.findByPerson_IdAndField_Id(person.getId(), field.getId())
                .map(existing -> {
                    existing.setValue(value == null ? "" : value.trim());
                    return existing;
                })
                .orElseGet(() -> setupValueRepository.save(new SetupValue(person, field, value == null ? "" : value.trim())));

        return SetupValueDto.from(setupValue);
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
