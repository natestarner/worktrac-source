// The user-facing NOUNS for the current account, as the server derived them.
//
// The app's vocabulary is family-shaped because the app was: a household, with family members in
// it. On a trainer's account every one of those words is wrong -- a client is not a family member,
// and "the owner of this household can see your workouts" is a noticeably worse sentence to read
// when you are paying that person to train you.
//
// ⚠️ THE SERVER DERIVES THESE, this file only reads them. `AccountDto.vocab` arrives with the plan
// and rides in the auth snapshot, so the nouns are right on a cold offline boot too. Do not add a
// second map here keyed by plan -- that is how the client and the emails start disagreeing.

// ⚠️ THE FALLBACK IS THE FAMILY NOUNS, AND IT IS LOAD-BEARING. A snapshot written before `vocab`
// existed has no such key, and a browser can hold one across a deploy (`resilience.md` axis D). The
// wrong-but-safe answer there is "household": it is correct for every account that has one, which
// is the overwhelming majority, and the failure mode is a familiar word rather than `undefined`
// rendered into a sentence about who can see your workouts.
//
// Same posture as PlanBadge on an unknown plan -- see planFeatures.js's note on why THAT one fails
// open in the other direction. These differ on purpose: this is chrome with a sensible default,
// that one is an entitlement that must not be stripped by a stale cache.
// `owner` is deliberately a noun PHRASE ("household owner") where the others are single words. It
// names the person running the account, and "Household" alone would name the account instead.
const FAMILY = {
  account: 'household',
  owner: 'household owner',
  member: 'family member',
  manager: 'co-parent',
};

/**
 * The nouns for this account, with every key guaranteed present.
 *
 * @param {{account?: string, owner?: string, member?: string, manager?: string}|null|undefined} vocab
 *   `AccountDto.vocab`, or nothing at all.
 */
export function accountVocab(vocab) {
  if (!vocab) return FAMILY;
  // Per-key rather than all-or-nothing: a server that adds a fifth noun later will hand older
  // clients a partial object, and one missing key must not blank the others.
  return {
    account: vocab.account || FAMILY.account,
    owner: vocab.owner || FAMILY.owner,
    member: vocab.member || FAMILY.member,
    manager: vocab.manager || FAMILY.manager,
  };
}

/**
 * Capitalises a noun for the start of a sentence or a field label.
 *
 * Exists so call sites never keep a second, capitalised copy of each word -- "Household" and
 * "Practice" drifting apart from their lowercase twins is exactly the kind of thing that survives
 * review.
 */
export function capitalize(noun) {
  if (!noun) return noun;
  return noun.charAt(0).toUpperCase() + noun.slice(1);
}
