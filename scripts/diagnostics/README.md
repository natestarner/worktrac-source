# Dev-server crash diagnostics

Kept deliberately, after a dev-server death took four investigations and roughly three weeks to
identify. It turned out to be Node v24.15.0 corrupting its own stack on Windows
(`docs/incidents/2026-09-01-vite-dev-server-node-stack-corruption.md`). **These are the tools that
answered it. Reach for them before theorising.**

## Start here when the dev server dies

The routine instrumentation is already permanent and needs no setup:

| Where | What it tells you |
|---|---|
| `.dev-logs/frontend.log` | `[[frontend exited native=… ]]` — the **real** exit code, with the mechanism named in plain English (`scripts/supervise-server.js`) |
| `bash scripts/deaths.sh` | Every death across every worktree, with host memory at that instant |
| `bash scripts/check-node-version.sh` | Fires at `up.sh` time if the running Node is a known-bad build |

**Read the native exit code. Never `rc=127`** — bash collapses every abnormal end to it, so a kill
and a crash are indistinguishable through that number. That single ambiguity is most of why this
went unsolved.

| Native | Meaning |
|---|---|
| `0xFFFFFFFF` | `TerminateProcess(-1)` — something killed it. Usually `down.sh`; expect `intent=planned` |
| `0xC0000409` | Fail-fast. **The subcode decides**: 2 = memory corruption, 7 = deliberate `abort()` |
| `0xC0000005` | Native access violation |
| small integer | A real self-exit — read the log above it |

Also check `intent`: a `planned` row is just a restart. Deaths within ~60s of a `down.sh` are
tagged automatically.

## The three tools

### `crash-order-probe.ps1` — who died first, and with what code

The chain collapses in under 50ms, so a coarse sampler cannot order it. Samples at ~40ms and
records each member's native exit code.

```
powershell -File scripts/diagnostics/crash-order-probe.ps1 -Port 3003 -Out probe.log
```

Leaf-first means Vite crashed or was targeted; ancestor-first means the tree is being torn down
from above.

### `parse-minidump.py` — which module actually faulted

No debugger is installed and admin rights are not available, but a minidump's exception record and
module list are enough to place blame.

```
curl -o procdump.zip https://download.sysinternals.com/files/Procdump.zip
procdump64 -accepteula -ma -e -t <vite-pid> ./dumps    # then reproduce
python scripts/diagnostics/parse-minidump.py
```

This is what proved the fault was in `node.exe` rather than Vite or its Rust addons.

### `node-ab.sh` — is it the Node build?

```
bash scripts/diagnostics/node-ab.sh /c/tmp/node2420/node.exe candidate 8
```

**Interleave the arms — bad, good, then bad again.** Sequential arms cannot separate "this build is
broken" from "the machine got quieter", and that confound nearly let a wrong conclusion through.
Grab a candidate build as a zip and extract only `node.exe` to a short path; no admin needed, and
the installed Node is left alone.

## Two mistakes worth not repeating

- **"No Windows Error Reporting event, therefore not a crash."** `__fastfail` bypasses exception
  handling *by design* and emits nothing. This was the single most expensive wrong inference.
- **"Host memory was comfortable, therefore not memory."** True, but it measured host commit
  charge — a different quantity from the failing allocation. Measure the *process*.
