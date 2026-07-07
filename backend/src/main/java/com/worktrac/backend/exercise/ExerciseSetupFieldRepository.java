package com.worktrac.backend.exercise;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;

public interface ExerciseSetupFieldRepository extends JpaRepository<ExerciseSetupField, Long> {

    Optional<ExerciseSetupField> findByIdAndExercise_Id(Long id, Long exerciseId);
}
