# Import and export

Export has existed since early on; import arrived later and was built as its **exact inverse**.
That framing is the load-bearing idea in this document — most of the design follows from it, and
several bugs came from places where the two halves were allowed to disagree.

Invariants a change must not break live in `.claude/rules/workout-data-model.md` and
`.claude/rules/resilience.md`. This file is the reasoning.

## The round trip is the contract

`GET /api/people/{id}/export.csv` writes a CSV. `POST /api/people/{id}/import` reads one. The
guarantee tying them together, and the anchor test in `CsvImportControllerTest`:

> Export person A, import that file into person B, export B — the two files are byte-identical.

Everything else is downstream of making that true.

### One derivation, two consumers

`export/WorkoutRowProjection` turns a person's stored data into a flat `List<ExportRow>` — sessions
oldest first, sets in `created_at` order, `Set #` counted per exercise per session.
`CsvExportService` formats those rows into CSV cells. `CsvImportService` compares incoming rows
*against* them to decide what it already has.

So "is this row a duplicate?" is answered by **"is this the CSV row one of my sets would export
as?"**. There is no second definition of what a set is, and there is nowhere for the two halves to
drift apart. The projection was extracted from `CsvExportService` for exactly this reason; keeping
the derivation in one place is worth more than the small indirection it costs.

### Two things the CSV could not express, and now can

Both were found by writing the round-trip test, and both made every re-import duplicate a person's
entire history:

- **`Time` was `HH:mm`.** Two sets logged 40 seconds apart were indistinguishable in the file, so
  nothing reading it back could tell a real second set from a copy of the first. It is now
  `HH:mm:ss`.
- **There was no session boundary.** Session grouping had to be guessed. A `Session Start` column
  now carries the session's own `startedAt`.

Neither is cosmetic. A file that cannot express a distinction the database makes is a file that
cannot round-trip, and an importer reading it can only guess.

## The column contract

Three columns are required. Everything else has a stated default, which is what lets someone import
a spreadsheet they kept by hand rather than only a file this app produced.

**Required** — a missing one is a 400 naming it:

| Column | Why it cannot be defaulted |
|---|---|
| `Exercise` | Nothing to log the set against |
| `Date` | Places the set in time, and defines the session when `Session Start` is absent |
| `Reps` **or** `Duration (sec)` | One must be present as a column, and each row must populate exactly one. Which is right depends on the exercise |

**Optional, with a default:**

| Column | Default |
|---|---|
| `Time` | **12:00:00 UTC**, plus one second per row within the date, in file order |
| `Weight` | `0` — which is what the column already means everywhere else: bodyweight |
| `Unit` | The account's default unit |
| `Session Start` | The same-day rule below |
| `Session Type` | `Logged Later` (`manual = true`) |
| `Set #` | Advisory only; order comes from the timestamp |
| `Rest (sec)` | `null`, as for any set not logged live |
| `Session Note`, `Exercise Note`, `Favorite`, `Tags` | Nothing written |

**Read but never imported:** `Custom Fields` (out of scope) and `Est. 1RM` (derived — recomputed on
export). Both are reported in the preview rather than dropped in silence.

Columns are matched **by name**, not position, so column order never matters and a file exported
before `Session Start` existed still reads correctly.

### Why noon, not midnight

A defaulted time uses **12:00:00 UTC**. History renders in the viewer's local time, so a set stamped
`00:00` UTC displays on the *previous day* for anyone west of Greenwich — someone would import
20 August and see 19 August. Noon is outside every real-world offset. The one-second-per-row offset
that follows it keeps ordering deterministic: identical timestamps would leave "Set 1 / Set 2" at
the mercy of whatever order the database returned, and re-export would not be stable.

### A default is only honest if it is shown

Every default that actually got applied comes back in `appliedDefaults` and is rendered in the
preview before anything is committed. The modal also states the whole contract in a collapsed
disclosure *before* a file is chosen. A person discovering the contract from an error message is
the failure both of those exist to prevent.

## Session grouping: two rules, no guessing

- **`Session Start` present** → group by its value. Exact.
- **`Session Start` absent** → **every row sharing a `Date` is one workout.**

The same-day rule is deliberately blunt. A cleverer heuristic — splitting when a `Set #` resets, say
— would split a day sometimes and not others, making the outcome unpredictable for whoever built
the file. "Everything I did that day is one workout" is both what a hand-built spreadsheet means and
something a person can reason about without reading this document. The cost is that two genuinely
separate workouts on one date merge; the fix for anyone who cares is the `Session Start` column that
every current export carries.

`manual` is true unless the file positively says every row was live, so a spreadsheet with no
`Session Type` column yields manual sessions throughout — the truthful reading of a backfill.

> ⚠️ **`endedAt` is never left null on a created session.** `WorkoutSessionService.getLiveSession`
> takes the person's first session with a null `endedAt`, so an imported 2019 workout with an open
> end would become their live session and quietly swallow the next set they logged.

### `Set #` is advisory, never structural

Rows are ordered by timestamp, tiebroken by **file order**. `Set #` is deliberately *not* a
tiebreaker: it counts per exercise, so comparing it across exercises is meaningless. It once sorted
a "Set 1" of one exercise ahead of a "Set 2" of another sharing the same second, silently reordering
a re-imported workout.

For the same reason `workout_sets` is read with a **total** order (`created_at, id`). Two sets can
genuinely share a `created_at` — the column is a `datetime2`, but a CSV round trip only carries
seconds — and without a tiebreaker SQL Server may return them in either order, which made export
non-deterministic for exactly the data an import produces.

## Duplicate detection

A CSV row is skipped when the person already has a set that would export as the same row. The
identity is `(exerciseId, createdAt, weight, unit, reps, durationSeconds)`.

Three details, each of which was a bug before it was a rule:

- **Compared at second precision.** `created_at` is a `datetime2` and carries sub-second precision;
  the file's `Time` is `HH:mm:ss`. Comparing raw instants means a row never matches the set it came
  from. Identity is measured at the precision that survives the round trip, not the precision the
  column happens to hold.
- **Weight is normalized to two decimal places.** `BigDecimal.equals` compares *scale* as well as
  value, and `Identity` is a record, so it uses `equals`. `135.00` from the column and `135` from a
  spreadsheet are the same load and must hash the same. `stripTrailingZeros` does **not** achieve
  that — it turns `135.00` into `1.35E+2`.
- **Matched as a multiset, not a set.** Occurrences are counted on both sides and `min(existing,
  incoming)` are skipped. Two genuinely distinct identical sets can share a timestamp; if the file
  has two and the person has one, the honest answer is to add one, not skip both.

### Not `client_key`, deliberately

A set logged in the app carries a UUID `client_key` the CSV never saw, so a key-based scheme would
fail on the likeliest case of all — re-importing into the same account. Imported sets are written
with a **null** `client_key`, like every other historical row.

### What this buys: idempotency

Duplicates are recomputed against live data at commit time, so a commit that timed out client-side
but succeeded server-side is safe to retry — the retry sees everything as a duplicate. That is the
direct answer to `docs/incidents/2026-08-01-email-blind-spots-and-delete-timeout.md`, where a client
giving up did not stop the transaction behind it.

**What it does not cover:** two commits of the same file racing each other. Under RCSI both read a
clean slate and both insert. The guard is the UI disabling the button while a commit is in flight;
the recovery is undo. An all-or-nothing transaction does not make concurrent commits safe — it only
makes each one atomic.

### Partial duplicates rejoin their workout

If a group's duplicate rows all sit in one existing session, the new rows are appended to it rather
than forking a second workout on the same day. That is what makes "delete one set, re-import the
file" restore the file exactly.

## What import writes, and what it never touches

**Writes:** sets, sessions, session notes, and — additively — the per-person exercise note, favorite
and tags. Missing exercises are created.

**Never overwrites.** A note is written only where the person has none; `Favorite` is only ever
turned on; tags are unioned. The file may be months old, and the only thing it can honestly claim is
what it *contains*, never the absence of anything.

> ⚠️ This is why `PersonExerciseService.applyImportedPersonalization` exists beside `setTags`.
> `setTags` **replaces** the whole tag set — correct for the tag editor, destructive for an import.
> Two writers with different semantics on the same relation is exactly the kind of thing that gets
> "simplified" into one; they differ on purpose.

**One genuine cross-person effect.** Exercises and tags are **account-scoped**, so importing one
person's file adds to the household's shared catalog and tag vocabulary. That is identical to what
"add your own exercise" already does, and it does not put anything in another person's *picker*
(which stays a per-person union) — but the preview says so, because someone importing one person's
history may not expect any household-wide change at all.

### Rejection is per row, not per file

A bad row is reported with its line number and the rest still import.

> The "reject as little as possible" rule in `backend-core.md` does **not** transfer here. That rule
> exists because a 400 permanently discards a durably-queued write. A synchronous import rejecting a
> row costs nothing — the person still has the file, and the preview names the line. A per-row error
> report is strictly better behaviour.

### Performance

Sets are built directly and `saveAll`ed in chunks of 500, **not** routed through
`WorkoutSetService`. `insertSetAndDetectPr` runs two `StatsService` queries per set for an `isPR`
flag used only by the celebration overlay — History, PRs and Trends all derive records on read.
Skipping it removes most of the query volume and avoids the read-then-write pattern on
`workout_sets` that deadlocked under load (`docs/incidents/2026-08-13-e2e-parallel-flakiness.md`).

The parser caps a file at 5 MB and 20,000 rows. That cap is what bounds the transaction.

## Import batches and undo

Every commit creates an `import_batches` row (V53), and the sets, sessions and session notes it
writes carry its id (V54/V55). An imported set is otherwise indistinguishable from a hand-logged one
— deliberately — so without the stamp there is no way back and no way to tell which data came from a
file.

`workout_sessions.import_batch_id` is set **only on a session the import created**, never on one it
appended to. Undo depends on telling those apart.

**Undo removes** the batch's session notes, its sets, and any session it created that is now empty.
**It does not** revert personalization or delete exercises the import created — those are additive,
shared, and may have been built on since; an exercise can have hand-logged sets against it by now.
The confirm dialog says so rather than letting "undo" imply more than it means. `undone_at` is a soft
marker, so the counts survive as an audit trail.

A commit that creates zero sets writes **no batch row**, so a retried commit that finds everything
already present doesn't leave a phantom empty entry in the history list.

### Undo can only reach one person's data

Every undo query is scoped by the batch **and** the owner, on top of `requireOwnedPerson` and a
person-scoped batch lookup:

```sql
DELETE workout_sets           WHERE import_batch_id = ? AND person_id = ?
DELETE workout_sessions       WHERE import_batch_id = ? AND person_id = ? AND (no sets remain)
DELETE session_exercise_notes WHERE import_batch_id = ? AND session.person.id = ?
```

The redundancy is the point. "Every row stamped with this batch belongs to this person" is an
app-layer invariant with **nothing in the schema enforcing it**, and a delete keyed on an unenforced
invariant is one bug away from crossing a person boundary — in the app whose entire product promise
is that it doesn't. `ImportUndoTest` forges that invariant on purpose (stamping a second person's set
with the first person's batch) and requires the delete to refuse anyway; it has been verified to fail
with the predicate removed.

### The foreign keys are `NO ACTION`, and the deletion order is circular

`workout_sets` already reaches `people` by two routes — directly, and via `workout_sessions ON DELETE
CASCADE`. A third cascading path through `import_batches` is the multiple-cascade-path configuration
SQL Server refuses outright. So the FKs don't cascade, and the constraints then read:

```
workout_sets.import_batch_id -> import_batches   (sets before batches)
import_batches.person_id     -> people           (batches before people)
people -> workout_sessions -> workout_sets       (deleting people is what deletes the sets)
```

No delete order satisfies all three. `ImportBatchCleanup` resolves it by **clearing the stamps
first** and deleting the batches second, leaving the workout rows to the ordinary person cascade.
`AccountDeletionService` and `TestDataCleanupService` both go through it. The latter matters more
than it looks: it runs after every local e2e run, so missing it surfaces as the whole suite failing
teardown rather than as anything to do with import.

## Excel input

The wire format stays CSV. An `.xlsx` is converted to CSV **in the browser** before the preview call,
so there is one parser on the server, one set of round-trip tests, and no backend dependency. The
converter is a format adapter, not a second importer. `.xlsx` only — not the old binary `.xls`. A
`.csv` saved *from* Excel already works: the parser handles a UTF-8 BOM and CRLF for exactly that.

The workbook is read directly — **`fflate`** (~8 kB, zero dependencies, browser-first) to unzip,
and the platform's own `DOMParser` for the XML. It is loaded lazily, only once someone picks an
`.xlsx`, so it lands in its own ~3.8 kB chunk and never enters the main bundle or the offline app
shell. Import is online-gated anyway.

### ⚠️ Why there is no xlsx library here

Both obvious choices are unavailable, and the first one cost a day to rule out.

**`read-excel-file` kills the Vite dev server.** With a dynamic `import('read-excel-file')` anywhere
in the source graph, the server was taken down partway through every full e2e run — five runs, five
deaths, at 3, 4, 43, 51 and 74 tests in, always with **no `[[frontend exited rc=...]]` marker**,
which is the signature of the whole process tree going down rather than Vite exiting on its own.
The trigger is that package's Node-oriented dependency graph (`unzipper`, `@xmldom/xmldom`), which
it carries even though its browser entry only needs `fflate`. `optimizeDeps.exclude` does **not**
fix it, so pre-bundling is not the mechanism.

Measured on one stack:

| | |
|---|---|
| `main`'s frontend | 170 passed, server intact |
| this feature, that one import removed | 176 passed, server intact |
| this feature, `import('fflate')` in its place | 176 passed, server intact |
| this feature with `read-excel-file` | died, 5 for 5 |

**`xlsx` (SheetJS) is not the alternative.** The last version published to npm is `0.18.5`, which
carries CVE-2023-30533; the fix ships only on the maintainers' own CDN.

**The lesson worth keeping is about attribution, not the library.** The absence of the exit marker
was read as proof that application code could not be responsible — the wrapper had died too, and
only something external can do that — and `deaths.sh` showed 26 prior occurrences of this death on
unrelated branches, including `main`. Both statements were true. Neither was evidence. A coherent
theory that fits every piece of static evidence is exactly what
`docs/incidents/2026-08-14-cold-boot-offline-spec-measured-liefi.md` warns about; only the control
run against `main` settled it. **Control-run before attributing a dev-server death to the
environment.**

**The conversion must stay value-aware.** A naive cell-to-string dump breaks duplicate detection
silently, because a spreadsheet stores exactly the columns identity is built from as **numbers**:
`2026-08-20` is the serial `46254`, and `09:14:32` is a fraction of a day. Whether a numeric cell is
a date is knowable *only* from its style's number format, which is why `xl/styles.xml` is read at
all — built-in formats 14–22 and 45–47, or a custom `formatCode` carrying date tokens outside its
quoted literals. Serials are converted against 1899-12-30 and formatted in **UTC**, because Excel
serials carry no timezone and the exporter writes UTC; reading them in the viewer's local zone would
shift every instant and break dedup against the very file this app produced. The server's tolerant
date parsing is a second line of defence, not a substitute.

Two more details the format forces, both of which silently corrupt data if missed:

- **Sheets are resolved through `xl/_rels/workbook.xml.rels`**, not by assuming sheet order matches
  `sheetN.xml` numbering — it does not reliably.
- **Cells are placed by their column letter**, because rows omit empty cells entirely. Appending in
  document order instead would shift every column after a blank one position left, landing values
  under the wrong heading.

A workbook's first sheet carrying the required columns is the one read, and the preview names it.

`workbookToCsv.test.js` builds **real `.xlsx` bytes** with `zipSync` rather than mocking a reader,
since the format itself is the entire risk here. That caught a five-day error in its own expected
serial on the first run.
