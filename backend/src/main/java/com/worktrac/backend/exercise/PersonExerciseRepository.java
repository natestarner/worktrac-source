package com.worktrac.backend.exercise;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.Optional;

public interface PersonExerciseRepository extends JpaRepository<PersonExercise, Long> {

    List<PersonExercise> findByPerson_Id(Long personId);

    /**
     * Every PersonExercise of this person with its tags AND custom fields loaded: two statements
     * whatever the count. For callers that read both collections on every row (the Log picker
     * list, CSV export, the importer's dedup). Both are lazy, so {@link #findByPerson_Id} followed
     * by a per-row read was one SELECT per exercise for each collection, and in production every
     * one of those is a cross-region round trip (PersonExerciseQueryCostTest).
     *
     * <p>Two statements, not one: fetching a Set and a List together multiplies the rows (tags x
     * fields per exercise). The second query fetches the custom fields into the SAME entities the
     * first loaded, which only works inside one persistence context, so the caller must be
     * {@code @Transactional}. Chosen per query, deliberately not a global
     * {@code hibernate.default_batch_fetch_size} (backend-core.md).
     */
    default List<PersonExercise> findWithPersonalizationByPersonId(Long personId) {
        List<PersonExercise> rows = findWithTagsByPersonId(personId);
        if (!rows.isEmpty()) {
            fetchCustomFieldsByPersonId(personId);
        }
        return rows;
    }

    @Query("SELECT DISTINCT pe FROM PersonExercise pe LEFT JOIN FETCH pe.tags WHERE pe.person.id = :personId")
    List<PersonExercise> findWithTagsByPersonId(@Param("personId") Long personId);

    // Only for its side effect on the persistence context: initialises customFields on the
    // entities findWithTagsByPersonId already loaded. See findWithPersonalizationByPersonId.
    @Query("SELECT DISTINCT pe FROM PersonExercise pe LEFT JOIN FETCH pe.customFields WHERE pe.person.id = :personId")
    List<PersonExercise> fetchCustomFieldsByPersonId(@Param("personId") Long personId);

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
