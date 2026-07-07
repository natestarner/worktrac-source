package com.worktrac.backend.routine;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface RoutineRepository extends JpaRepository<Routine, Long> {

    List<Routine> findByPerson_IdOrderByCreatedAtAsc(Long personId);

    Optional<Routine> findByIdAndPerson_Id(Long id, Long personId);
}
