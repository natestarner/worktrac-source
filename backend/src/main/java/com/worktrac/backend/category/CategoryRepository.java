package com.worktrac.backend.category;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.Optional;

public interface CategoryRepository extends JpaRepository<Category, Long> {

    @Query("SELECT c FROM Category c WHERE c.account IS NULL OR c.account.id = :accountId ORDER BY c.name ASC")
    List<Category> findVisibleToAccount(@Param("accountId") Long accountId);

    Optional<Category> findByIdAndAccount_Id(Long id, Long accountId);
}
