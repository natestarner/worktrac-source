# 2026-09-01 — The Vite dev server died mid-run for months. It was a Node.js bug.

**Symptom.** The frontend dev server vanished partway through an e2e run, leaving `rc=127` in the
death ledger, no error output, a healthy backend beside it, and ~60 red specs that read exactly
like a code regression. First recorded 2026-08-17; still happening 2026-09-01. Four separate
investigations, four different conclusions, none of which held.

**Root cause.** **Node.js v24.15.0 corrupts its own stack under concurrent load on Windows.**
Windows' `/GS` stack-cookie check catches the corruption and fail-fasts the process instantly and
silently — which is why there was never an error message, never a crash dialog, and never a
Windows Error Reporting event.

It was never Vite, never npm, never the console, never memory.

## Why it took four attempts

Every investigation was reading instruments that could not answer the question:

1. **`rc=127` carries no information.** bash collapses *every* abnormal end to wait status 32512.
   Measured: an external `Stop-Process -Force` (native `0xFFFFFFFF`) and a fail-fast crash
   (native `0xC0000409`) both arrive as "exit 127". The one number everyone reasoned from could
   not distinguish a crash from a kill.
2. **The `[[frontend exited rc=…]]` marker had never once been written.** Zero occurrences in any
   `frontend.log`, against 8 in `backend.log`. Git Bash's `bash.exe`, spawned with
   `DETACHED_PROCESS`, silently discards its own stdout, while a native Windows child writing the
   **same** inherited handle succeeds. So Vite's output landed and the log looked healthy, while
   the line explaining the death never appeared — and `e2e.sh`'s "no marker means something killed
   it" fired every time regardless of the truth.
3. **`intent=unexpected` was wrong for much of the ledger.** `up.sh` deleted the planned-stop
   sentinel ~20s in, while the dying server records asynchronously — tens of seconds under load.
   Ordinary `/run-local` restarts were therefore filed as unexplained deaths. 23 of the
   "unexpected" deaths have `chrome=0` (no test run in flight at all), and one batch shows four
   servers across three worktrees dying inside the same second: a machine-wide shutdown, every row
   marked unexpected.

Two "ruled out by instruments" conclusions were also wrong:

- *"A crash is ruled out — zero WER events."* `__fastfail` bypasses exception handling **by
  design** and produces no WER event. Absence of WER never ruled a crash out.
- *"Memory is ruled out — commit was comfortable."* True but irrelevant; it measured host commit
  charge, which is a different quantity from the failure. Vite's own peak was 572 MB against
  Node's multi-GB ceiling, and *falling* in the final seconds.

## The evidence that settled it

A full minidump (ProcDump, no admin needed) parsed for its exception record and module list:

```
code            : 0xC0000409
fast-fail code  : 2  (STACK_COOKIE_CHECK_FAILURE)
faulting module : C:\Program Files\nodejs\node.exe  +0x21F2189
```

Fast-fail **code 2**, not code 7. That distinction is the whole answer: code 7
(`FATAL_APP_EXIT`) is `abort()` — a deliberate panic. Code 2 is the `/GS` cookie check finding
the stack overwritten, i.e. genuine memory corruption inside `node.exe`.

Then A/B, identical load (`E2E_WORKERS=11`, full e2e suite):

| Node | Crashes |
|---|---|
| **v24.15.0** | **2 in 3** (plus 3 earlier hunts that each crashed on attempt 1) |
| v24.14.1 | **0 in 8** |
| v24.20.0 | see `dev-stack.md` for the version this repo pins |

Also eliminated along the way, each by measurement rather than argument:

- **Vite** — reproduces identically on Vite **7.3.6** (rollup + esbuild) and Vite **8.2.1**
  (rolldown), so neither the new toolchain nor its Rust native addons are implicated. The
  `rolldown` binding is loaded in the process but the fault is in `node.exe`.
- **Rust panic** — reproduced with `RUST_BACKTRACE=full`; no panic message.
- **V8 fatal error / OOM** — `--report-on-fatalerror` produced no report (verified the flag *does*
  fire on a real V8 OOM).
- **Playwright teardown** — no `webServer` in `playwright.config.ts`; workers keep cycling for 10+
  seconds after Vite dies.
- **Job objects / console CTRL events** — everything is `inJob=True` including the backend, which
  survives.

Upstream: [nodejs/node#62991](https://github.com/nodejs/node/issues/62991) reports intermittent
native crashes on Windows in v24.15.0 specifically, with v24.14.1 called out as known-good.
Different exit code in that report, same version, platform and class.

## Takeaways

1. **Pin the Node version, and refuse to run on a known-bad one.** A floating `node-version: '24'`
   in CI and whatever is installed locally is how a bad patch release walked in. `up.sh` now warns
   when the running Node is on the known-bad list.
2. **Never diagnose one of these from `rc=127`.** Read the native exit code that
   `scripts/supervise-server.js` now records: `0xFFFFFFFF` = something killed it (usually
   `down.sh`, so expect `intent=planned`); `0xC0000409` = it fail-fasted — check the fast-fail
   subcode before assuming `abort()`; `0xC0000005` = native crash; a small integer = a real
   self-exit.
3. **A diagnostic that can only return one answer is worse than none.** For three weeks the
   tooling asserted "something killed it" on every occurrence, which is what sent each
   investigation looking for a killer that did not exist.
4. **Absence of evidence from a mechanism that is designed not to produce evidence proves
   nothing.** "No WER event, therefore not a crash" was the single most costly inference here.
