package com.worktrac.backend.personcategory;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface PersonCategoryRepository extends JpaRepository<PersonCategory, Long> {

    List<PersonCategory> findByPerson_IdOrderBySortOrderAscNameAsc(Long personId);

    Optional<PersonCategory> findByIdAndPerson_Id(Long id, Long personId);

    boolean existsByPerson_IdAndName(Long personId, String name);
}
