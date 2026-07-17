package com.worktrac.backend.exercise;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.Optional;

public interface ExerciseRepository extends JpaRepository<Exercise, Long> {

    // Every global (shared) exercise, plus this account's own exercises.
    @Query("SELECT e FROM Exercise e WHERE e.deleted = false AND ("
            + "e.account IS NULL OR e.account.id = :accountId) ORDER BY e.name ASC")
    List<Exercise> findVisibleToAccount(@Param("accountId") Long accountId);

    Optional<Exercise> findByIdAndAccount_Id(Long id, Long accountId);

    void deleteByAccount_Id(Long accountId);
}
