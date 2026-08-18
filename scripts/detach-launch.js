// Launch a long-running dev server that OUTLIVES the shell that started it.
//
// Why this exists (2026-08-18): the frontend kept dying mid-e2e-run with rc=127 and no error
// output, and two earlier investigations blamed the npm shim and then host commit-charge
// exhaustion. Both were wrong. What actually happens is that Vite was never detached at all:
//
//   * `setsid` does not exist in the stock Git-for-Windows bash this project is developed on, so
//     up.sh's `_detach` silently degrades to bare `nohup` -- which ignores SIGHUP but leaves the
//     process INSIDE the launching shell's tree.
//   * Measured: the whole chain died in the same one-second tick --
//       bash <- bash <- npm(node) <- cmd <- vite(node)
//     including both bash shells. Vite was never targeted; the shell tree was torn down and Vite
//     went with it.
//   * The backend survives the same teardown only BY ACCIDENT: Maven forks the Spring Boot JVM
//     into a process whose parent has already exited, so the real server is already orphaned and
//     no longer in the tree. That -- not "the JVM commits its heap at startup while node allocates
//     continuously" -- is the real explanation for the frontend/backend asymmetry.
//
// The documented workaround ("start the stack from a separate invocation than your test run")
// cannot be followed from an agent session at all: those keep ONE persistent shell across every
// command, so up.sh and the test run always share it.
//
// `child_process.spawn(..., { detached: true })` is the piece that was missing. On Windows it sets
// DETACHED_PROCESS + CREATE_NEW_PROCESS_GROUP, so the child gets no console and no process group
// tie to us. Verified: a probe launched this way reports an ancestry of exactly itself, with no
// parent -- the same shape as Maven's forked JVM, and the opposite of the five-deep chain into
// bash that Vite used to have.
//
// Node specifically (not PowerShell Start-Process, which was tried and reverted in 2026-08-09 and
// 2026-08-16) because this is a Node project: `node` is guaranteed present wherever `npm run dev`
// could have run, and passing argv as an array sidesteps the cmd/PowerShell quoting that made the
// earlier attempts unreliable to start.
//
// Usage:  node scripts/detach-launch.js <logfile> <command> [args...]
// Output: appends the child's stdout+stderr to <logfile>; prints the detached pid.

const { spawn } = require('child_process');
const fs = require('fs');

const [logPath, command, ...args] = process.argv.slice(2);

if (!logPath || !command) {
  console.error('usage: node detach-launch.js <logfile> <command> [args...]');
  process.exit(2);
}

// Append, never truncate: up.sh owns the log's session banners, and the exit marker written by the
// dying wrapper has to survive alongside them.
const out = fs.openSync(logPath, 'a');

const child = spawn(command, args, {
  detached: true,
  // stdin explicitly ignored. Inheriting it would leave the server holding a handle to the
  // launching shell's stdin, which is both a way to get dragged down with that shell and a way for
  // Vite's CLI-shortcut reader to see an unexpected EOF.
  stdio: ['ignore', out, out],
});

// Drop the parent's reference so THIS process can exit immediately, leaving the child orphaned.
child.unref();

console.log(child.pid);
