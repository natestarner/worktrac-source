# The barrage

A repeatable pressure test of the app on **lower** (or a local stack), built from the History-sync
review of 2026-09-26. It drives the real deployed app and API with multi-year data through every
condition the app must survive, checks the result against the server after each one, and writes a
report. Kick it off with **`/barrage`** (`.claude/commands/barrage.md`); this file is the reference.

It complements the e2e suite rather than repeating it. e2e specs run fresh households with a
handful of sets, one assertion each. The barrage runs **five years of History** and uses:

- simulated devices that apply sync replies exactly as the app does;
- real browsers (Chromium and WebKit) doing offline drains, lost responses, cold boots, two tabs and
  upgrades;
- load;
- a side-by-side comparison against production's build;
- lower's own logs and database metrics.

```bash
node e2e/barrage/barrage.mjs --target lower --tier quick      # ~20 min
node e2e/barrage/barrage.mjs --target lower --tier standard   # ~1 h
node e2e/barrage/barrage.mjs --target lower --tier full       # ~2-3 h
node e2e/barrage/barrage.mjs --target local --tier standard   # this worktree's stack
node e2e/barrage/barrage.mjs --watch-deploy                   # through the next lower deploy
node e2e/barrage/barrage.mjs --help
```

Exit code: 0 no failures, 1 failures, 2 couldn't run. The report is written to
`e2e/barrage-reports/<run>/report.md` (gitignored), with `results.json` and failure screenshots
beside it.

## Tiers and suites

| Suite | What it proves | quick | standard | full |
|---|---|:-:|:-:|:-:|
| `api:abuse` | Hostile or odd input: bounds (400), other households (404), foreign workout ids leak nothing | x | x | x |
| `api:correctness` | Every History-changing write (live set, edit, notes, delete, a past workout in a new month, moving it across months, a rename). After each one, five simulated devices must equal `GET /history`: scoped, ordinary, restored-from-snapshot, restored-then-scoped, fresh | x | x | x |
| `api:bench` | Sync timings on this History, after waiting for the database to be idle; then every PRs / Trends / Log-summary endpoint on the same History, with body sizes | x | x | x |
| `browser:chromium` | The browser matrix below; quick runs its core five | core | all | all |
| `browser:webkit` | The same in Safari's engine (see limits) | | 7 | all |
| `signin` | A fresh device downloads History once per person | x | x | x |
| `api:load` | A household mid-workout for 2 min: every device converges | | x | x |
| `perf` | Phone-sized Chromium at 4x CPU throttle: first load, reload, logging a set, style/layout | | x | x |
| `perf:stats` | The same phone, History already held: opening PRs, opening Trends, switching the range; main-thread script and every stats response | | x | x |
| `api:storm` | Two writers plus back-to-back syncs for 60s: correctness under contention | | | x |
| `compare` | **Local:** production's build vs this one on identical data. Two parts: identical History, badges, celebration, Last time, PRs, Trends; and History requests, and PRs / Trends / summary requests, per everyday flow | | | x |
| `cold-start` | The app opened while lower is scaled to zero | | | x |
| `ops` | Lower's logs for the run window: the drift canary, unexpected exceptions, slow syncs, database CPU | x | x | x |

The browser matrix (each scenario in a fresh profile, ending with "the app's **persisted** History
equals `GET /history` for every person, once the outbox is empty"):

| Scenario | Guards |
|---|---|
| `two-months-drain` / `-slow-sync` | Two writes in different months, drained together (#356) |
| `big-drain` | 10 writes across 4 months, past the scope bound of 8 |
| `drain-on-reopen` | Writes queued offline, app closed, reopened online |
| `lost-responses` | Uploads committed on the server with their responses dropped; reopen replays them; **no set stored twice** |
| `two-tabs` | A stale offline tab and an online tab during the drain |
| `other-device-on-open` | App opened with a queued set while another device changed an older month (#357) |
| `cold-boot-offline` | Opened with no network at all from the service worker (Chromium only) |
| `lie-fi` | Every API call hanging to the app's 15s abort |
| `old-format-upgrade` | A cache in the pre-sync array format renders unreachable, then is replaced |
| `rolling-check` | Every month due a re-read: ordinary syncs carry the rolling check, the server answers it, nothing re-downloads everything, the drift canary stays quiet |
| `multi-person` | A second person's History, and per-person isolation |
| `long-jump` | `content-visibility` on History blocks; a jump two years down lands visible, clear of the tab bar |

Options: `--suites a,b` (any names above; `browser:<engine>[:core|:standard]`), `--engines`,
`--only scenario,...`, `--baseline <sha>` for `compare`, `--no-wait`.

## Setup

**Credentials never go in the repo.** For lower, set `BARRAGE_EMAIL` / `BARRAGE_PASSWORD`, or write
them to `~/.worktrac/barrage.env` (outside the repo):

```
BARRAGE_EMAIL=...
BARRAGE_PASSWORD=...
```

The account must be **dedicated to testing**. The barrage writes to it and cleans up after itself,
but it is meant to hold years of synthetic History. `--seed` imports five years of daily workouts
into it once (three imports, two years each, throttled per account). The run refuses to start on an
account with fewer than 1,500 workouts.

**Local** needs no credentials: the barrage registers a throwaway account through the test-support
endpoint and seeds it. It serves production builds itself on this worktree's frontend port, so
start the stack and **stop the dev frontend** first (the `/barrage` command does this):

```bash
bash scripts/up.sh      # then stop only the frontend -- see .claude/commands/barrage.md
```

`compare` in the `full` tier on lower uses the same local backend. When that backend isn't running,
it is skipped with a note.

Needs: Node (the repo's version), `e2e/node_modules` (`npm ci` in `e2e/`; `npx playwright install
webkit` once for WebKit), and for the lower-only parts the `gh` and `az` CLIs signed in (read-only;
`docs/azure-read-only-access.md`). Without `gh`/`az` those parts are skipped, not failed.

## Rules it enforces, and why each one exists

Every one of these cost real time on 2026-09-26.

- **It waits for any running lower deploy to finish first** (`--no-wait` overrides). A barrage
  alongside lower's e2e run pushed the 5-DTU database to 93% and made a History spec flake that was
  never the app's fault.
- **Timings wait for an idle database.** A post-e2e cleanup once doubled every API timing.
- **Convergence waits for an empty outbox** before comparing. "History equals the server" while
  writes are still queued proves nothing about those writes; a check that skipped this passed for
  the wrong reason.
- **`GET /history` is polled no faster than every 5s.** A five-year History costs the database
  ~2.8s per call, and polling every 1.5s saturated lower.
- **One fresh browser profile per scenario.** A filter left by one scenario, or a second person
  left selected, broke the next for reasons unrelated to the app.
- **Workouts are found by position, never by date label.** History's labels omit the year, so
  "Aug 30" matches one workout per year of History. A workout's index in `GET /history` is its
  block's position on screen (one Edit button per block).
- **WebKit gets 120s actions and 180s convergence.** Playwright's WebKit on Windows is far slower
  than Safari on a phone: leaving a five-year History took ~57s there against ~9s in Chromium, on
  production's build as well. Slow must not read as broken.
- **It never sends a valid History drift report.** A drift report writes the one log line that
  means a real bug, so `ops` treats any `History drift:` line in the window as a failure.
- **Cleanup always runs.** It deletes the sets written since the run started (in the workouts it
  touched and any workout started since), the people and exercises it added, and ends the live
  workout. Empty past workouts it created can't be deleted (no endpoint); they hold no sets, so
  History never shows them.

## Reading a report

`report.md` opens with the failures and warnings, then tables (timings, requests per flow, logs),
then every check.

**Triage a failure before calling it a regression.**

1. Re-run just that scenario: `--suites browser:chromium --only <scenario>`. The report says which
   scenario and shows a screenshot.
2. Control-run it against the previous build: locally, `--target local --baseline <sha>`, or
   compare with the previous report.
3. Read what the failure says. A "still queued after Ns" is the app not draining. A differing
   workout id is History disagreeing with the server. A click timeout in WebKit is usually the
   engine's slowness.

**Expected warnings** (known, recorded so a change is noticed):

- `api:abuse` "at: year 9999" is a 503 (DATETIME2 overflow) rather than a 400. It is cosmetic; only
  a hand-made request can send it.
- `signin` "with a workout in progress" sends **2** full syncs per person. The Log tab's own
  refresh on load replaces the first download in flight. This was found by the barrage's first run
  and is a small follow-up to fix.
- `browser:webkit` `cold-boot-offline` is SKIP. Playwright's WebKit can't navigate while its
  offline emulation is on. Check it by hand on an iPhone: open the app in airplane mode.
- `ops` "History changed while it was being read" 503s: the designed retry under concurrent
  writes. `api:storm` and the drains produce some.

## Limits

- It is not Safari on an iPhone. Before a release that touches offline behavior, also check by hand
  on a phone: History, a long scroll, a set logged in airplane mode, and a cold open in airplane mode.
- `compare` needs the local stack; `cold-start` needs lower otherwise idle so it can scale to zero,
  and it waits up to 25 min for that.
- Absolute timings depend on the day's load on lower. The pass/fail guards in `perf` are about
  what the History work promises (bytes per reload and per set, style/layout staying small), not
  about speed.

## Extending it

A new browser scenario is one `await scenario(ctx, 'name', async ({ ctx: c, page }) => { ... })`
block in `suites/browser.mjs`. Rules for writing one:

- End with `converge(...)`.
- Find workouts with `pickIn(page, personId, monthsBack(n))`.
- Record every workout you write to with `cleanup.touch(id)`.
- Add it to `CORE_SCENARIOS` / `WEBKIT_STANDARD` in `barrage.mjs` if the quicker tiers should run it.

An API check goes in `suites/api.mjs` against `Device` + `expectEqual`. Keep the rules above; each
was a real false result once.
