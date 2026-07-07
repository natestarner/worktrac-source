package com.worktrac.backend.routine;

import com.worktrac.backend.common.NotFoundException;
import com.worktrac.backend.exercise.Exercise;
import com.worktrac.backend.exercise.ExerciseRepository;
import com.worktrac.backend.person.Person;
import com.worktrac.backend.person.PersonService;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

@Service
public class RoutineService {

    private final RoutineRepository routineRepository;
    private final ExerciseRepository exerciseRepository;
    private final PersonService personService;

    public RoutineService(RoutineRepository routineRepository, ExerciseRepository exerciseRepository,
                           PersonService personService) {
        this.routineRepository = routineRepository;
        this.exerciseRepository = exerciseRepository;
        this.personService = personService;
    }

    @Transactional(readOnly = true)
    public List<RoutineDto> list(Long accountId, Long personId) {
        Person person = personService.requireOwnedPerson(personId, accountId);
        return routineRepository.findByPerson_IdOrderByCreatedAtAsc(person.getId()).stream()
                .map(RoutineDto::from)
                .toList();
    }

    @Transactional
    public RoutineDto create(Long accountId, Long personId, RoutineRequest request) {
        Person person = personService.requireOwnedPerson(personId, accountId);
        Routine routine = new Routine(person, request.name().trim());
        applyExercises(accountId, routine, request.exerciseIds());
        return RoutineDto.from(routineRepository.save(routine));
    }

    @Transactional
    public RoutineDto update(Long accountId, Long personId, Long routineId, RoutineRequest request) {
        Person person = personService.requireOwnedPerson(personId, accountId);
        Routine routine = routineRepository.findByIdAndPerson_Id(routineId, person.getId())
                .orElseThrow(() -> new NotFoundException("No such routine"));
        routine.setName(request.name().trim());
        routine.getExercises().clear();
        applyExercises(accountId, routine, request.exerciseIds());
        return RoutineDto.from(routine);
    }

    @Transactional
    public void delete(Long accountId, Long personId, Long routineId) {
        Person person = personService.requireOwnedPerson(personId, accountId);
        Routine routine = routineRepository.findByIdAndPerson_Id(routineId, person.getId())
                .orElseThrow(() -> new NotFoundException("No such routine"));
        routineRepository.delete(routine);
    }

    private void applyExercises(Long accountId, Routine routine, List<Long> exerciseIds) {
        int order = 0;
        for (Long exerciseId : exerciseIds) {
            Exercise exercise = exerciseRepository.findById(exerciseId)
                    .orElseThrow(() -> new NotFoundException("No such exercise"));
            boolean visible = exercise.isGlobal() || exercise.getAccount().getId().equals(accountId);
            if (!visible) {
                throw new NotFoundException("No such exercise");
            }
            routine.getExercises().add(new RoutineExercise(routine, exercise, order++));
        }
    }
}
