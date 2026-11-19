# A forgotten legacy column made households undeletable (2026-11-19)

## Symptom

On production, account 12's owner typed DELETE, entered the right password, and got
*"Huddle is having trouble reaching your data right now. Try again in a moment."* Six attempts
between 22:16 and 22:20 UTC all failed the same way. Nothing was deleted: the deletion is one
transaction, and it rolled back each time (the Stripe cancellation runs only after commit).

## Root cause

```
DataIntegrityViolationException: The DELETE statement conflicted with the REFERENCE constraint
"FK_users_account" ... table "dbo.users", column 'account_id'.  [delete from accounts where id=?]
```

- `users.account_id` dates from V2, when one login belonged to exactly one household.
- Member logins phase 2 (#250, 2026-09-06) moved that to `account_memberships`. V65 made the column
  nullable and `User` stopped mapping it. The column was due to be dropped a release later as
  "V72", but that version number went to an unrelated billing migration, so the drop was never
  written.
- Every login created **before** #250 still carried its original household's id, and
  `FK_users_account` still enforced it.
- `AccountDeletionService` deletes a login only when no other membership needs it, which is correct.
  So for a pre-#250 login that also belongs to another household, the login survives still naming
  the household being deleted, and the final `DELETE FROM accounts` fails the FK.
- `GlobalExceptionHandler` maps `DataAccessException` to a 503, which is honest for an outage and
  misleading here, because retrying can never succeed.

## Why no test caught it

Every login a test creates is post-#250, so its `account_id` is NULL. The failing shape exists only
in data that production (and lower) accumulated before the split. Before this fix, no test deleted
a household whose login belonged to a second household at all.

## Fix

`V106__drop_users_account_id.sql` drops the FK, the index and the column. Safe for a rolling deploy:
both environments ran `d7cbcd9`, far past #250, so no running revision reads the column. Nothing is
lost, since `account_memberships` is the only source of truth. The column was deliberately **not**
used to backfill memberships first, because a revoked login still carried its old `account_id` and
that would have undone the revocation.

`AccountDeletionTest#deletingOneHouseholdKeepsALoginThatStillBelongsToAnother` was red (503) with
the legacy value written by hand before V106, and is green after.
`#usersNoLongerCarryALegacyAccountId` pins the schema. `MembershipBackfillTest` was deleted: it ran
V64's one-shot backfill SQL against seeded `users.account_id` rows, V64 has long since run
everywhere, and the column it seeds no longer exists.

## Takeaway

The contract half of an expand/contract is not tidy-up. While an unmapped column still has
constraints, it is still live schema. Track the drop as a real follow-up with its gate, not as a
version number reserved in a comment (`.claude/rules/member-access.md`).
