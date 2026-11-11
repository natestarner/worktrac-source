package com.worktrac.backend.identity;

import org.springframework.data.jpa.repository.EntityGraph;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.Optional;

public interface UserIdentityRepository extends JpaRepository<UserIdentity, Long> {

    // The ONLY way a sign-in finds its user: by the provider's stable subject. There is
    // deliberately no findByEmailAtLink -- signing in by an email a provider asserts is exactly the
    // account-takeover shape docs/architecture/social-sign-in.md rules out.
    @EntityGraph(attributePaths = "user")
    Optional<UserIdentity> findByProviderAndSubject(IdentityProvider provider, String subject);

    Optional<UserIdentity> findByUser_IdAndProvider(Long userId, IdentityProvider provider);

    List<UserIdentity> findByUser_IdOrderByCreatedAtAscIdAsc(Long userId);

    long countByUser_Id(Long userId);

    /**
     * Removes a login's identities ahead of the login itself. The database cascade would do it,
     * but only this also detaches any identity the current transaction has loaded -- see
     * AccountDeletionService for the 503 that happens otherwise.
     */
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("delete from UserIdentity i where i.user.id = :userId")
    void deleteAllForUser(@Param("userId") Long userId);
}
