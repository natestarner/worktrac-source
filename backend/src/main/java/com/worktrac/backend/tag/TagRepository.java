package com.worktrac.backend.tag;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.Optional;

public interface TagRepository extends JpaRepository<Tag, Long> {

    List<Tag> findByAccount_IdOrderByNameAsc(Long accountId);

    Optional<Tag> findByIdAndAccount_Id(Long id, Long accountId);

    // Case sensitivity follows the DB collation (SQL Server default is case-insensitive), so
    // this doubles as the "chest" vs "Chest" de-dup for free-text tagging.
    Optional<Tag> findByAccount_IdAndName(Long accountId, String name);

    void deleteByAccount_Id(Long accountId);

    // Genuine single-statement bulk delete for TestDataCleanupService -- see
    // PersonRepository.deleteByAccountIdIn's comment for why this is safe and preferred over the
    // derived, entity-at-a-time deleteByAccount_Id above for that specific caller.
    @Modifying
    @Query("DELETE FROM Tag t WHERE t.account.id IN :accountIds")
    void deleteByAccountIdIn(@Param("accountIds") List<Long> accountIds);
}
