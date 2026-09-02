// Run a dev server and record its REAL exit code when it dies.
//
// Why this exists (2026-09-01): for months the frontend died mid-run with "rc=127" and nobody
// could tell whether it had crashed or been killed. Both halves of that diagnostic were broken:
//
//   1. bash reports 127 for EVERY abnormal end. Measured: an external `Stop-Process -Force`
//      (native exit 0xFFFFFFFF) and a Node fail-fast abort (native exit 0xC0000409) both arrive
//      at bash as wait status 32512, i.e. "exit 127". The ledger's rc has therefore never been
//      able to distinguish a crash from a kill -- which is the single question every
//      investigation started from.
//   2. The `[[... exited rc=...]]` marker was written by a bash `echo` to the stdout that
//      detach-launch.js hands the child. Git Bash's bash.exe, spawned with DETACHED_PROCESS,
//      silently discards its own stdout writes -- while a native Windows child (node) writing the
//      SAME inherited handle works fine. So Vite's output landed and made the log look healthy,
//      the marker never appeared, and `e2e.sh` told everyone "no marker means something killed
//      it" every single time, regardless of the truth.
//
// This supervisor is a node process, so its writes DO reach the log, and it gets the child's real
// exit code and signal from the 'exit' event. Two measured deaths under the same load were
// 0xC0000409 and 0xFFFFFFFF -- two different failure modes that the old instrument merged into
// one. Typing them apart is the prerequisite for fixing either.
//
// Usage: node supervise-server.js <logfile> <label> <slug> <scriptsDir> <command> [args...]
const { spawn } = require('child_process');
const fs = require('fs');

const [logPath, label, slug, scriptsDir, command, ...args] = process.argv.slice(2);
if (!logPath || !label || !command) {
  console.error('usage: node supervise-server.js <logfile> <label> <slug> <scriptsDir> <cmd> [args...]');
  process.exit(2);
}

// Inherit: the child's own output still goes wherever ours does, exactly as before.
//
// shell:true on Windows because npm is a .cmd, which node refuses to spawn directly. That puts a
// cmd.exe between us and npm -- which is harmless for our purpose: the probe measured the native
// code propagating intact up through BOTH cmd.exe and npm-cli.js (all three read 0xC0000409 on a
// crash). bash is the only link in the chain that mangles it, and it is no longer in the path.
// A shell is needed ONLY to launch a .cmd (npm). Spawning a real .exe through cmd.exe breaks on
// any space in its path ("C:/Program Files/..." arrives as the token "C:/Program") and trips
// DEP0190. So use the shell only when the target is not an executable.
const needsShell = process.platform === 'win32' && !/\.exe$/i.test(command);
const child = spawn(command, args, { stdio: 'inherit', shell: needsShell });

child.on('exit', (code, signal) => {
  const when = new Date().toISOString().replace(/\.\d+Z$/, '');
  // `code` is the real process exit code. Windows fail-fast/termination codes arrive as large
  // negatives; render the hex too, because that is what actually names the mechanism.
  const hex = typeof code === 'number' ? ' (0x' + (code >>> 0).toString(16).toUpperCase().padStart(8, '0') + ')' : '';
  const known = {
    '0xFFFFFFFF': 'TerminateProcess(-1) -- an EXTERNAL KILL (Stop-Process -Force / Process.Kill)',
    '0xC0000409': 'STATUS_STACK_BUFFER_OVERRUN -- a __fastfail ABORT INSIDE the process',
    '0xC0000005': 'ACCESS_VIOLATION -- a native crash',
    '0xC000013A': 'CTRL+C / console shutdown',
  };
  const hexKey = '0x' + ((code >>> 0).toString(16).toUpperCase().padStart(8, '0'));
  const verdict = known[hexKey] ? '  <- ' + known[hexKey] : '';

  let line = `[[${label} exited native=${code}${hex} signal=${signal}${verdict} at ${when}]]\n`;
  try {
    fs.appendFileSync(logPath, line);
  } catch {
    /* the log is best effort; the ledger below is the durable copy */
  }

  // Hand the ledger the NATIVE code rather than bash's 127, so the shared history becomes
  // typeable going forward.
  const rec = spawn('bash', [scriptsDir + '/record-memory-state.sh', label, slug, String(code)], {
    stdio: 'inherit',
  });
  rec.on('exit', () => process.exit(0));
  rec.on('error', () => process.exit(0));
});

child.on('error', (err) => {
  try {
    fs.appendFileSync(logPath, `[[${label} failed to start: ${err.message}]]\n`);
  } catch { /* ignore */ }
  process.exit(1);
});
