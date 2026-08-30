package com.worktrac.backend.exercise;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface PersonExerciseFieldRepository extends JpaRepository<PersonExerciseField, Long> {

    // Quota enforcement (QuotaService).
    long countByPersonExercise_Id(Long personExerciseId);


    List<PersonExerciseField> findByPersonExercise_IdOrderBySortOrderAsc(Long personExerciseId);

    Optional<PersonExerciseField> findByIdAndPersonExercise_Id(Long id, Long personExerciseId);
}
