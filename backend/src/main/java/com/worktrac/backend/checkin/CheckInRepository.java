package com.worktrac.backend.checkin;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.Optional;

public interface CheckInRepository extends JpaRepository<CheckIn, Long> {

    /**
     * One person's timeline, newest first, with private entries included ONLY when the caller is
     * staff.
     *
     * <p>⚠️ <b>ONE query, taking the answer as a parameter, rather than two methods a call site
     * chooses between.</b> The choice is the dangerous part: a caller that picked the wrong one —
     * or a new caller that reached for the unfiltered method because it was there — shows a client
     * what their trainer wrote about them. There is deliberately no "find all for person" method on
     * this repository for anyone to reach for.
     *
     * @param includePrivate true only for a caller holding {@code WRITE_OTHER_PEOPLE}; see
     *                       {@code CheckInService.list}, which is the only thing that may decide it
     */
    @Query("SELECT c FROM CheckIn c WHERE c.person.id = :personId "
            + "AND (c.visibleToPerson = true OR :includePrivate = true) "
            + "ORDER BY c.enteredAt DESC, c.id DESC")
    List<CheckIn> findVisibleTo(@Param("personId") Long personId,
                                @Param("includePrivate") boolean includePrivate);

    /** Scoped by person so a check-in id from another person cannot be reached by guessing. */
    Optional<CheckIn> findByIdAndPerson_Id(Long id, Long personId);

    void deleteByPerson_IdIn(List<Long> personIds);
}
