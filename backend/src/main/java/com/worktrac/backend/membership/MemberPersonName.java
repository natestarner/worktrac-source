package com.worktrac.backend.membership;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * One login in this household, paired with the person NAME it belongs to — and nothing else.
 *
 * <p>Deliberately as narrow as {@link AccountMembershipRepository#findOwnerPersonNames}: the only
 * thing anything downstream is allowed to learn from a creator stamp is a name to put on screen.
 * No email, no id beyond the one needed to join, nothing a member could act on outside the app.
 * Same rule {@code MembershipDto.ownerName} carries.
 */
public record MemberPersonName(Long userId, String personName) {

    /**
     * Collapse the rows into a lookup, skipping anything unusable.
     *
     * <p>{@code putIfAbsent} rather than {@code put}: the schema permits more than one membership
     * per (account, user) even though the app never creates one, and an arbitrary last-write-wins
     * would make the displayed name depend on row order. First wins, deterministically.
     */
    public static Map<Long, String> toMap(List<MemberPersonName> rows) {
        Map<Long, String> byUserId = new HashMap<>();
        for (MemberPersonName row : rows) {
            if (row.userId() == null || row.personName() == null || row.personName().isBlank()) {
                continue;
            }
            byUserId.putIfAbsent(row.userId(), row.personName());
        }
        return byUserId;
    }
}
