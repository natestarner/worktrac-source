package com.worktrac.backend.routine;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface RoutineRepository extends JpaRepository<Routine, Long> {

    // Quota enforcement (QuotaService).
    long countByPerson_Id(Long personId);


    // sort_order is the person's own arrangement (V61/V62); id breaks ties defensively so the
    // order is total even if two rows ever share a position.
    List<Routine> findByPerson_IdOrderBySortOrderAscIdAsc(Long personId);

    // The tail of a person's list, for appending on create/copy. One row rather than loading
    // every routine just to read the last one's position.
    Optional<Routine> findFirstByPerson_IdOrderBySortOrderDesc(Long personId);

    Optional<Routine> findByIdAndPerson_Id(Long id, Long personId);
}
