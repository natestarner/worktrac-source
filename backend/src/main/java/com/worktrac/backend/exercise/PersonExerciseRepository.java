package com.worktrac.backend.exercise;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface PersonExerciseRepository extends JpaRepository<PersonExercise, Long> {

    List<PersonExercise> findByPerson_Id(Long personId);

    Optional<PersonExercise> findByPerson_IdAndExercise_Id(Long personId, Long exerciseId);
}
