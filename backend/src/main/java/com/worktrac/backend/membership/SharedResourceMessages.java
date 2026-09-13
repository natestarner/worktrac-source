package com.worktrac.backend.membership;

import java.util.List;

/**
 * The copy a member sees when a shared resource is refused, in one place because two services
 * (exercises and tags) raise the same refusal and the wording is the whole point of it.
 *
 * <p>Every message here follows the same shape: <b>one sentence for what happened, one for what to
 * do about it.</b> A refusal a person cannot act on is just an obstacle.
 */
public final class SharedResourceMessages {

    private SharedResourceMessages() {
    }

    /**
     * Why a rename was refused on something other people are already using, and who can help.
     *
     * @param noun      "exercise" or "tag", so the sentence reads naturally
     * @param ownerNames the household's owner names, as returned by
     *                   {@code AccountMembershipRepository.findOwnerPersonNames} — empty is
     *                   legitimate and degrades to naming nobody rather than printing "null"
     */
    public static String inUse(String noun, List<String> ownerNames) {
        String who = ownerNames.isEmpty() || ownerNames.get(0) == null || ownerNames.get(0).isBlank()
                ? "the account owner"
                : ownerNames.get(0);
        return "Other people have already used this " + noun + ", so renaming it would change their "
                + "history too. Ask " + who + " to rename it, or add your own " + noun + " instead.";
    }
}
