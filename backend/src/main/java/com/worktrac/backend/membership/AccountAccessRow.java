package com.worktrac.backend.membership;

// The flat projection AccountMembershipRepository.findAccessRow returns: everything needed to
// answer "is this token still valid, and what may it do here", in one row.
//
// Separate from AccountAccess because the two answer to different things. This mirrors the
// DATABASE -- add a column, add a field. AccountAccess is what the app reasons with, and carries
// values the database has no opinion on (accountIsPro is derived from a subscription's state, not
// stored). Collapsing them would tie the request-time model to the schema.
public record AccountAccessRow(
        Long userId,
        Long accountId,
        Long membershipId,
        AccountRole accountRole,
        Long personId,
        int tokenVersion,
        boolean membersSeeEveryone) {
}
