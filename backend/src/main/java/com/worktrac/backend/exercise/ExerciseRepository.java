package com.worktrac.backend.exercise;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.Optional;

public interface ExerciseRepository extends JpaRepository<Exercise, Long> {

    // A global exercise this account has forked (see Exercise.forkedFrom) is excluded
    // here -- the forked, account-owned copy takes its place in the list instead.
    @Query("SELECT e FROM Exercise e WHERE e.deleted = false AND ("
            + "(e.account IS NULL AND e.id NOT IN ("
            + "  SELECT f.forkedFrom.id FROM Exercise f WHERE f.account.id = :accountId AND f.forkedFrom IS NOT NULL"
            + ")) OR e.account.id = :accountId) ORDER BY e.name ASC")
    List<Exercise> findVisibleToAccount(@Param("accountId") Long accountId);

    Optional<Exercise> findByIdAndAccount_Id(Long id, Long accountId);

    boolean existsByCategory_Id(Long categoryId);
}
