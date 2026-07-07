package com.worktrac.backend.workoutsession;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface WorkoutSessionRepository extends JpaRepository<WorkoutSession, Long> {

    Optional<WorkoutSession> findFirstByPerson_IdAndEndedAtIsNull(Long personId);

    List<WorkoutSession> findByPerson_IdOrderByStartedAtDesc(Long personId);

    Optional<WorkoutSession> findByIdAndPerson_Id(Long id, Long personId);

    // Defense-in-depth: lets a controller confirm a session belongs to the caller's
    // account without trusting a client-supplied personId at all.
    Optional<WorkoutSession> findByIdAndPerson_Account_Id(Long id, Long accountId);
}
