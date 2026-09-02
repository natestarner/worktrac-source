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

## SOLVED 2026-09-01 — it was a Node.js bug, not Vite

**Node v24.15.0 corrupts its own stack under concurrent load on Windows.** Windows' `/GS`
stack-cookie check catches it and fail-fasts the process instantly and silently, which is why
there was never an error message, a crash dialog, or a WER event. Everything above this section
was reasoning about instruments that could not see it. Full narrative:
`docs/incidents/2026-09-01-vite-dev-server-node-stack-corruption.md`.

Minidump, parsed for its exception record and module list:

```
code            : 0xC0000409
fast-fail code  : 2  (STACK_COOKIE_CHECK_FAILURE)   <- NOT 7 (abort); real memory corruption
faulting module : C:\Program Files\nodejs\node.exe
```

A/B on this repo's own e2e suite at `E2E_WORKERS=11`:

| Node | Crashes |
|---|---|
| **v24.15.0** | **2 in 3** (plus three earlier hunts that each crashed on the first run) |
| v24.14.1 | 0 in 8 |
| v24.20.0 | 0 in 8 |

Reproduces identically on Vite **7.3.6** and Vite **8.2.1**, so it is neither the new toolchain
nor its Rust native addons. Upstream: [nodejs/node#62991](https://github.com/nodejs/node/issues/62991)
(Windows-only; Linux/macOS unaffected, so CI on ubuntu was never at risk).

`scripts/check-node-version.sh` warns at `up.sh` time when the running Node is on the known-bad
list. **Add to that list rather than rediscovering this**, and don't pin CI for it — the bug is
Windows-only and CI does not run there.

### Read the native exit code, never `rc=127`

`scripts/supervise-server.js` records the real code, because bash collapses every abnormal end to
127 — an external `Stop-Process -Force` and a fail-fast crash are indistinguishable through it.

| Native | Meaning |
|---|---|
| `0xFFFFFFFF` | `TerminateProcess(-1)` — something killed it. Usually `down.sh`, so expect `intent=planned` |
| `0xC0000409` | fail-fast. **Check the subcode**: 2 = stack corruption, 7 = deliberate `abort()` |
| `0xC0000005` | native access violation |
| small integer | a real self-exit |

### What this retires

- *"A crash is ruled out — zero Application Error / WER events."* **Wrong inference, and the most
  expensive one.** `__fastfail` bypasses exception handling *by design* and produces no WER event.
- *"Memory is ruled out — commit was comfortable."* True but irrelevant: it measured host commit
  charge. Vite's own peak was 572 MB against Node's multi-GB ceiling, and falling at the end.
- *"The console-CTRL event is the root cause, fixed by `detach-launch.js`."* Detaching is correct
  and stays, but it did not reduce the death rate (5, 9 either side of 2026-08-18) and it is what
  broke the exit marker.
- *"There are 66 unexplained deaths."* A large share were routine `/run-local` restarts misfiled
  as unexpected — `up.sh` deleted the planned-stop sentinel before the dying server could read it.

Still ruled out by instruments, not argument: Playwright teardown (no `webServer` in
`playwright.config.ts`; its workers keep cycling 10+ s after Vite dies) and job objects
(everything is `inJob=True`, including the backend that survives).

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
