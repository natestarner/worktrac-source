package com.worktrac.backend.exercise;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.Optional;

public interface PersonExerciseRepository extends JpaRepository<PersonExercise, Long> {

    List<PersonExercise> findByPerson_Id(Long personId);

    Optional<PersonExercise> findByPerson_IdAndExercise_Id(Long personId, Long exerciseId);

    /**
     * "Has anyone OTHER than this person applied this tag?" -- the tag counterpart of
     * {@code WorkoutSetRepository.existsByExercise_IdAndPerson_IdNot}, and the question that
     * decides whether renaming it would relabel somebody else's screens.
     *
     * <p>A @Query rather than a derived name because the tag sits behind a {@code @ManyToMany} join
     * table, which a derived method cannot express.
     *
     * <p>{@code personId} is never null at the call site -- only a MEMBER reaches this check, and a
     * member always has a person -- but a null would make {@code <>} answer UNKNOWN for every row
     * and so report "used by nobody", which is the unsafe direction. The service guards it rather
     * than relying on that.
     */
    @Query("SELECT CASE WHEN COUNT(pe) > 0 THEN true ELSE false END FROM PersonExercise pe "
            + "JOIN pe.tags t WHERE t.id = :tagId AND pe.person.id <> :personId")
    boolean isTagAppliedByAnotherPerson(@Param("tagId") Long tagId, @Param("personId") Long personId);
}
