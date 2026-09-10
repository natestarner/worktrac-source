package com.worktrac.backend.exercise;

/**
 * Who added an exercise, and whether the CURRENT login may rename it right now.
 *
 * <p>⚠️ Computed per-request, for the caller — not a property of the exercise. Exactly the contract
 * {@code TagDto.deletable} carries, and for the same reason: {@code renamable} answers "would
 * {@code PUT /api/exercises/{id}} succeed for me, right now", so the client never re-derives
 * authorship and in-use from raw ids to decide whether to offer the control. See member-access.md's
 * "a control the server will refuse must not be offered".
 *
 * <p>{@code createdByName} is a NAME and nothing more — no email, no id — the same rule
 * {@code MembershipDto.ownerName} carries. Null is legitimate and must render as naming nobody:
 * a global row has no creator by design, V67 lists three ways a household row's stamp is
 * legitimately null, and a revoked login's rows lose their name (see
 * {@code AccountMembershipRepository.findPersonNamesByUser}).
 *
 * <p>There is deliberately NO permissive no-access factory here, unlike {@code TagDto.from(Tag)}.
 * That one exists because {@code PersonExerciseDto}'s nested tag mapping genuinely has no
 * {@code AccountAccess} to ask; every exercise DTO construction site has one, so a default would be
 * an unused footgun rather than a documented safe placeholder.
 */
public record ExerciseAttribution(String createdByName, boolean createdByYou, boolean renamable) {

    /** A global (preloaded) row: nobody added it to this household, and nobody may rename it. */
    static final ExerciseAttribution GLOBAL = new ExerciseAttribution(null, false, false);
}
