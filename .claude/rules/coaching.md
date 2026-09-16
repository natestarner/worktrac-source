---
paths:
  - "backend/src/main/java/com/worktrac/backend/account/**"
  - "backend/src/main/java/com/worktrac/backend/membership/**"
  - "backend/src/main/java/com/worktrac/backend/exercise/**"
  - "frontend/src/utils/accountVocab.js"
  - "frontend/src/hooks/useAccountAccess.js"
  - "frontend/src/components/settings/AppSettingsTab.jsx"
  - "backend/src/main/java/com/worktrac/backend/checkin/**"
  - "backend/src/main/java/com/worktrac/backend/routine/**"
  - "e2e/tests/pro-private-clients.spec.ts"
---

# Coaching tiers — Pro now, Team next

Pro sells a trainer three things a family account does not need: **clients who cannot see each
other**, an **assistant** who can see all of them, and (later) a roster, programs and check-ins.
Team will sell a club the near-opposite — everyone visible, a leaderboard, approved results.

**Both are the same shape with different switch positions.** This file is what keeps that true, so
Team is an addition rather than a second retrofit.

## The role ladder

| Role | Sees | Writes | Account settings & billing |
|---|---|---|---|
| `OWNER` | everyone | everyone | yes |
| `MANAGER` | everyone | everyone | **no** |
| `MEMBER` | self, or everyone — decided by `members_see_everyone` | self only | no |

- **A private client is not a new role.** It is `MEMBER` in an account with
  `members_see_everyone = false`, which is exercised code rather than a new branch.
- **The assistant is `MANAGER`, deliberately not `COACH`.** Team's OWNER is the one a club calls
  "coach", so that word has to stay free — `AccountVocab` is where it will be spent, as display
  vocabulary, not as a role name. Owner / Manager / Member also reads correctly for a practice, a
  club **and** a second parent on a family account, which no domain-specific ladder does.
- ⚠️ **`MANAGER` does not inherit new permissions the way `OWNER` does.** `OWNER_PERMISSIONS` is
  `EnumSet.allOf`; `MANAGER`'s set is enumerated. That fails closed, which is the right direction,
  but it is silent — the symptom is "the assistant cannot do the new thing", with nothing throwing.
  **When you add a `Permission`, decide in `PermissionMappingTest` whether a manager holds it.**
- ⚠️ **`MANAGER` is excluded from `EXPORT_ACCOUNT_DATA` on purpose.** That permission was split off
  from per-person export precisely so "can see everyone" could not silently become "can walk out
  with the whole roster in one click" — an argument that applies with *more* force to an assistant
  than to a family member. A manager can still export any one client, which is what the job needs.

### The client's mirror of that ladder

`useAccountAccess` answers "what may this login do here?" and its `isOwner` is written as
**`!isMember && !isManager`**, never `=== 'OWNER'`. The negative form is what preserves the hook's
fail-open contract: an unknown role (a v1 snapshot, a still-booting render) must answer TRUE, or an
offline owner is told they may not manage their own household.

⚠️ It was `!isMember` until `MANAGER` existed, which silently made every assistant an owner in the
client's eyes and offered them billing and account deletion the server refuses. **Any role added
later is owner-shaped by default for that same reason, so a new non-owning role must be subtracted
there in the commit that adds it.**

## Member visibility

`accounts.members_see_everyone` (V66) shipped with no endpoint and no UI, so that Free and Plus were
forced to "everyone sees everyone" by construction rather than by a check somebody could flip.

| Tier | Default | Can change it? |
|---|---|---|
| Free / Plus | `true` | **No** — 409, and that is a promise to the family |
| Pro | `false` (private) | Yes, `OWNER` only |
| Team *(next)* | `true` | Yes |

- **`PUT /api/account/member-visibility` is the ONLY writer.** A profile-gated test-support route
  used to write the column directly; it was deleted rather than kept beside this one, because it
  skipped the plan gate and could therefore put a household into a state the product cannot reach.
  Two writers for one setting is the bug.
- **The plan gate lives in the SERVICE, not the controller**, because it answers **409** ("you
  could, on Pro") rather than **403** ("not you"), and an interceptor cannot tell those apart.
- **`MANAGE_HOUSEHOLD`, so not a `MANAGER`.** Whether the clients can see each other is a promise
  the account made to the people in it, and it belongs to whoever made it.
- ⚠️ **A downgrade does NOT restore `true`.** Flipping visibility back on when Pro lapses would
  expose every client's training to every other client as a side effect of a billing lapse. The
  logins pause (`MembershipStatus.PAUSED_PLAN`); the setting waits.

## ⚠️ The exercise catalogue is the one place the privacy claim can be quietly false

`exercises` and `tags` are **account**-scoped, not person-scoped. So hiding a sibling's sessions
says nothing about the exercise NAMES they created — a client entering *"Rehab — post-op shoulder"*
had it surface in every other client's picker, which is a medical disclosure the account promised
not to make.

- **Filter the READ; never refuse the write.** `CREATE_SHARED_RESOURCE` stays granted to every
  member regardless of visibility, because creating an exercise is a durable offline write and a
  403 on one of those is **terminal** — it would discard the create *and* every set queued behind
  its temp id.
- **Scope the dedup lookup identically.** `ExerciseService.add` resolves an existing row before
  creating; against the account-wide set it can return a row the caller cannot see, and the client
  is told they created something that never appears.
- `seesWholeCatalogue(access)` is `membersSeeEveryone || has(VIEW_OTHER_PEOPLE)` — one predicate, so
  a role added later is covered without a second place branching on roles.
- **Any new account-scoped collection must answer this question before it ships.** Ask: *can a
  private client's own text reach a sibling through this?* Tags are the next one.
- Pinned by `pro-private-clients.spec.ts` and `MemberPermissionsTest`. Note the person-switcher test
  stays green with the catalogue wide open — **the catalogue needs its own coverage** and cannot be
  assumed covered by person-level privacy.

## Vocabulary

`AccountVocab.forPlan` is the only place a tier becomes a NOUN, carried on `AccountDto.vocab` and
read by `frontend/src/utils/accountVocab.js`.

| Plan | account | owner | member | manager |
|---|---|---|---|---|
| Free / Plus | household | household owner | family member | co-parent |
| **Pro** | **practice** | **trainer** | **client** | **assistant** |
| Team *(next)* | team | coach | athlete | assistant coach |

- **It is presentation, never authority.** Tiers become capability in `BillingPlan.features()` and
  roles become authority in `AccountRole.permissions()`. `AccountVocabTest` asserts the record can
  hold nothing but `String`s, specifically so it cannot grow into a third answer to "what may they
  do".
- **Derived server-side** so it survives a cold offline boot in the auth snapshot and the email
  templates can share the same map.
- **Absence falls back to the family nouns, per key.** A snapshot written before `vocab` existed is
  the normal case for the first load after a deploy.
- `forPlan` is an exhaustive switch with **no default**, so adding `TEAM` fails the build until
  somebody maps it. A default would silently call a sports team a household.

## Check-ins — one table, two uses, and the naming is the risk

`check_ins` is a dated entry about a PERSON (not a set, not an exercise). One column tells the two
uses apart:

| `visible_to_person` | What it is | Who reads it |
|---|---|---|
| `0` | a manager's private observation | staff only |
| `1` | a check-in the person can see, including every one they wrote | the person, staff, and anyone who can view them |

- ⚠️ **"Staff" means `WRITE_OTHER_PEOPLE`, never `VIEW_OTHER_PEOPLE`.** The names look
  interchangeable and are not: on a family account with visibility ON, **every MEMBER holds
  `VIEW_OTHER_PEOPLE`**, so gating on it would show a teenager whatever their parent wrote
  privately about their sibling. Only OWNER and MANAGER hold `WRITE_OTHER_PEOPLE`.
- **The filter lives in ONE repository query** (`findVisibleTo(personId, includePrivate)`), taking
  the answer as a parameter. There is deliberately **no "find all for person" method** for a new
  call site to reach for — the choice between two methods is the dangerous part.
- **A person can never make an entry invisible to themselves.** Meaningless, and it would create a
  place in the app their trainer can read but they cannot un-write. Forced, not refused: this is a
  durable write and a 4xx would discard it.
- **An empty entry (no weight, no note) is a 400, refused in the service.** Left to
  `CK_check_ins_has_content` it would be a 500 — which `shouldRetryWrite` treats as transient, so
  a durable write of nothing would retry forever and **wedge the single serial outbox scope** behind
  it. Discarding an entry that records nothing loses nothing.
- **Deleting somebody else's entry answers 404, not 403.** Being refused *differently* would tell a
  client that a private entry about them exists.

### ⚠️ This is the THIRD note concept. Keep the labels mutually non-containing.

Two already exist and the person can see both:

| Concept | Table | Its label |
|---|---|---|
| a standing note on one exercise | `person_exercise.note` (V35) | "standing note" |
| a note for one workout | `session_exercise_notes` (V36) | "Note for this session" |
| **a dated entry about a person** | **`check_ins` (V78)** | **"Check-ins"** |

Neither of the first two is about a person and neither is ever private. **The check-in surface never
uses the word "note" as a label** — Playwright matches accessible names as a case-insensitive
substring and "Notes" already exists on the same screens, so a "Private note" control would break
unrelated specs and read as a fourth concept. Visibility is a property of a check-in, not a
different kind of thing.

## The promises that do not move

- **The password promise is verbatim on every surface** — *"They cannot see or set your password."*
  Only the surrounding NOUN changes with the tier ("owns this household" / "owns this practice").
  There is no `CHANGE_ANY_PASSWORD`; a trainer must not be able to impersonate a client any more
  than a parent may impersonate a teenager. Same sentence in the Profile, the invite email, the
  handbook and the privacy policy — see `member-access.md`.
- **Export is free on every tier and must stay so.** It is what makes "your data lives in your
  trainer's account" acceptable rather than lock-in. Import remains Plus-gated, so the honest round
  trip is *export free → import needs a paid plan*. **Never write copy promising a client can
  "take it with them"** — that implies a free landing spot which does not exist.
- **Revoking a login is not destructive**, and deleting the trainer's account deletes the clients'
  data. Under Pro that is *other people's* data, so the confirm names the client count.

## What Team still needs

Verified as unblocked, not built. Each is a pure addition:

| Team needs | Reuses |
|---|---|
| `BillingPlan.TEAM` + its `features()` row | the tier map |
| visibility default `true` + the toggle | the setting above, unchanged |
| "assistant coach" | `MANAGER`, displayed through `AccountVocab` |
| the squad view | the roster |
| group assignment | program templates |
| athlete count | the seat machinery |
| `/for-teams` | the audience-page shape |

**The only genuinely new mechanism Team needs is result approval** — a `verified_by_user_id` on
whatever feeds the leaderboard. Nothing in the Pro build may foreclose it.

### Adding TEAM: what will stop you, and that is by design

Verified by actually adding the constant and compiling, not by reading the code. **Two files refuse
to build until somebody decides**, in this order:

1. `BillingPlan.features()` — what Team grants.
2. `AccountVocab.forPlan()` — what a club calls its people (`team` / `coach` / `athlete` /
   `assistant coach`).

Both are exhaustive switches with **no default**, which is the whole point: a default would silently
hand a sports team the word household and an empty feature set, and the failure would surface as a
screenshot in a bug report rather than at build time. **Do not add a default to either.**

On the client there is no compiler, so the equivalent is a test: `planCopy.test.js` asserts
`Object.keys(PLANS)` matches `Object.keys(PLAN_FEATURES)`, so adding a tier to one and not the
other goes red. `PLAN_ORDER` deliberately names only tiers somebody can actually buy.

Everything else is additive: the visibility toggle, `MANAGER`, the roster, programs, check-ins and
the seat machinery all take Team without modification.
