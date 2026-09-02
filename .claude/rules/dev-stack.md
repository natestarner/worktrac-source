---
paths:
  - "scripts/**"
---

# Local dev stack (`scripts/up.sh`, `down.sh`, `e2e.sh`)

Full narrative: `docs/DEVELOPMENT.md`. Death forensics and the failed hypotheses:
`.claude/rules/e2e-tests.md` and the comment block at the top of `up.sh`.

## The frontend MUST be launched with its own console — this is not a style choice

`scripts/detach-launch.js` exists because **`setsid` is absent from stock Git-for-Windows**, so
`up.sh`'s `_detach` silently degrades to bare `nohup`. `nohup` ignores SIGHUP but leaves the child
**attached to the launching shell's console**, and a console-wide CTRL event reaches every process
on that console at once. That is what killed Vite mid-run for months, and it presents as
`[[frontend exited rc=127]]` with no error output and a healthy backend beside it.

- **Never route the frontend back through `_detach`, `nohup`, or a plain `&`.** Measured via
  `AttachConsole`: the `nohup` path **has** a console, `detach-launch.js` (node's
  `spawn({detached:true})` → `DETACHED_PROCESS` + `CREATE_NEW_PROCESS_GROUP`) has **none**.
- **A parent-process listing cannot tell the two apart** — the chain root is orphaned either way,
  because `up.sh`'s own shell exits. Anyone re-investigating this from ancestry alone will conclude
  the launch is already detached and be wrong. Check console attachment, not parentage.
- **`up.sh` and `detach-launch.js` must ship together.** `up.sh` fails fast if the launcher is
  missing; without that guard the frontend just never starts and you wait out a 150s timeout that
  then tails a log nothing ever wrote.
- **The backend is deliberately NOT on this path.** It already survives (Maven forks the Spring
  Boot JVM away from the launching shell), and changing its launch is what got a PowerShell
  `Start-Process` substitute reverted twice — once for the pair, once for the frontend alone.
  Don't "unify" the two launches for symmetry.

## 2026-09-01 — there are TWO failure modes, and `rc=127` could never tell them apart

**Everything above this section was reasoning about a broken instrument.** Both halves of the
diagnostic were measured wrong, and fixing them changed the answer:

1. **`rc=127` carries no information.** bash collapses every abnormal end to wait status 32512.
   Measured the same day: an external `Stop-Process -Force` (native `0xFFFFFFFF`) and a fail-fast
   abort inside Vite (native `0xC0000409`) both arrive at bash as "exit 127".
2. **The `[[frontend exited rc=…]]` marker had never once been written.** Zero occurrences in any
   `frontend.log`, against 8 in `backend.log`. Git Bash's `bash.exe`, spawned with
   `DETACHED_PROCESS`, silently discards its own stdout, while a native Windows child writing the
   **same** inherited handle succeeds — so Vite's output landed, the log looked healthy, and
   `e2e.sh`'s "no marker means something killed it" fired every single time regardless of truth.

3. **`intent=unexpected` was wrong for a large share of the ledger.** `down.sh` drops a sentinel
   before killing, and a death is "planned" only if that sentinel is under 60s old — but `up.sh`
   used to **delete the sentinel the moment both ports answered**, ~20s in, while the dying server
   records its own exit asynchronously. Under load that lag is tens of seconds: a stop measured at
   20:33:17.3 — 1.3s after `down.sh` wrote the sentinel — did not reach the ledger until 20:33:44,
   by which point the breadcrumb was gone. So **ordinary `/run-local` restarts were filed as
   unexpected deaths.** Tells: 23 of the "unexpected" frontend deaths have `chrome=0` (no test run
   in flight, i.e. exactly what a restart looks like), and one batch shows four servers across
   three worktrees dying inside the same second — a machine-wide shutdown, all marked unexpected.
   `up.sh` now lets the sentinel age out instead.

**So the ledger's 66 "mysteries" were inflated.** With the native code recorded, the only death so
far confirmed natural — mid-e2e, no fresh sentinel anywhere — carried `0xC0000409`, a fail-fast
abort **inside** the process. Every `0xFFFFFFFF` (external kill) instance examined has been
accounted for: `down.sh` doing its job, or a deliberate verification kill. **An external killer has
not been demonstrated to exist.** Do not go hunting one without a sample that survives this
sentinel check.

**Read the native code, never `rc=127`** — and check `intent` before treating anything as a bug.
`0xFFFFFFFF` = something killed it (usually `down.sh`, so expect `intent=planned`); `0xC0000409` =
it aborted itself; `0xC0000005` = native crash; a small integer = a real self-exit.

### What this retires

- *"A crash is ruled out — zero Application Error / WER events."* **Wrong inference.**
  `__fastfail` (`0xC0000409`) terminates without running exception handlers, so it produces no WER
  event by design. Absence of WER never ruled a crash out, and one of the two modes is a crash.
- *"Host commit-charge exhaustion is ruled out — commit 49–60% at every death."* Stale. Deaths are
  now recorded at **84–92%** commit with 24–76 concurrent Chrome processes. Commit is not the sole
  cause (23 deaths happened with `chrome=0`), but the old numbers no longer describe the picture.
- *"The console-CTRL event is the root cause, fixed by `detach-launch.js`."* Detaching was correct
  and should stay, but it **did not reduce the death rate**: 5, 9 on either side of 2026-08-18 and
  unchanged after. It also introduced the lost-marker bug above.

The npm-shim finding still stands (127 appeared with npm removed) — and is now explained: 127 was
never about npm, it is just what bash reports for any abnormal end.

Ruled out by instruments, not argument — don't re-derive these: Playwright teardown (there is no
`webServer` in `playwright.config.ts`, and its workers keep cycling for 10+ s after Vite dies) and
Vite's own memory (peak 572 MB private against Node's multi-GB ceiling, and *falling* in the final
seconds, with handles and threads flat).

## Detaching means nothing reaps it for you

A detached dev server **outlives the terminal or agent session that started it** — that is the
point, and it is also the one behaviour change. It does not accumulate: `up.sh` runs `down.sh`
first, so the next start on that worktree reclaims its own port. A stray server between sessions is
cleared with `bash scripts/down.sh` in that worktree.

## Worktree isolation is by PORT, and every script must keep it that way

Each worktree derives and persists its own `BACKEND_PORT`/`FRONTEND_PORT` (`worktree-env.sh`) and
its own database. **`down.sh` finds what to stop with `netstat` on those ports and kills by PID —
never by image name**, which would take out a sibling worktree's servers (and any unrelated
`node`/`java` on the machine).

- Detaching does not weaken this: the detached Vite is still the process holding the port, so the
  netstat lookup still resolves to it. Verified — stop/start leaves both ports free and no orphaned
  npm/cmd wrappers.
- **Anything new that stops a server must select by this worktree's port**, and must leave the
  shared `worktrac-sqlserver` container alone.
