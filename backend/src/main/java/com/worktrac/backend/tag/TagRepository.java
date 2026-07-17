package com.worktrac.backend.tag;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface TagRepository extends JpaRepository<Tag, Long> {

    List<Tag> findByAccount_IdOrderByNameAsc(Long accountId);

    Optional<Tag> findByIdAndAccount_Id(Long id, Long accountId);

    // Case sensitivity follows the DB collation (SQL Server default is case-insensitive), so
    // this doubles as the "chest" vs "Chest" de-dup for free-text tagging.
    Optional<Tag> findByAccount_IdAndName(Long accountId, String name);

    void deleteByAccount_Id(Long accountId);
}
