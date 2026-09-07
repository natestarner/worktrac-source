package com.worktrac.backend.membership;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.Optional;

public interface MembershipInviteRepository extends JpaRepository<MembershipInvite, Long> {

    /**
     * The one outstanding invite for a person, if any.
     *
     * <p>{@code UX_membership_invites_pending} (V71) is what makes "one" true — the index is
     * filtered to {@code accepted_at IS NULL}, so accepted history sits alongside without colliding.
     */
    @Query("SELECT i FROM MembershipInvite i WHERE i.account.id = :accountId "
            + "AND i.person.id = :personId AND i.acceptedAt IS NULL")
    Optional<MembershipInvite> findPendingFor(@Param("accountId") Long accountId,
                                              @Param("personId") Long personId);

    /** Everything outstanding in a household, for the owner's Logins list. */
    @Query("SELECT i FROM MembershipInvite i WHERE i.account.id = :accountId AND i.acceptedAt IS NULL")
    List<MembershipInvite> findPendingForAccount(@Param("accountId") Long accountId);

    // ── Deletion ordering ────────────────────────────────────────────────────────────────────
    // Every FK here is NO ACTION (V71), so these rows must be gone before the accounts, people and
    // users they point at. Both deletion paths call one of these; both have tests pinning it.

    @Modifying
    @Query("DELETE FROM MembershipInvite i WHERE i.account.id = :accountId")
    void deleteByAccountId(@Param("accountId") Long accountId);

    @Modifying
    @Query("DELETE FROM MembershipInvite i WHERE i.account.id IN :accountIds")
    void deleteByAccountIdIn(@Param("accountIds") List<Long> accountIds);

    /**
     * Clears the "who sent this" stamp without deleting the invite.
     *
     * <p>Needed because {@code invited_by_user_id} outlives the account boundary: a member user row
     * can be deleted by the e2e cleanup while an invite they sent in ANOTHER household is still
     * outstanding. Nulling the stamp keeps the invitation valid — losing who sent it is a smaller
     * harm than losing the invitation, and the alternative is a foreign-key failure during cleanup
     * that looks entirely unrelated to invites.
     */
    @Modifying
    @Query("UPDATE MembershipInvite i SET i.invitedByUserId = NULL WHERE i.invitedByUserId IN :userIds")
    void clearInvitedByForUsers(@Param("userIds") List<Long> userIds);
}
