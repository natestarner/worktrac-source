// What lower itself says about the run window: errors and warnings in the backend's logs, the
// History drift canary, slow syncs, and database CPU. Read-only (az, the Reader principal).
import { dbCpu, kql } from '../lib/ops.mjs';

const rows = (data) => (Array.isArray(data) ? data : data?.tables?.[0]?.rows ?? []);

export async function ops(ctx) {
  const S = 'ops';
  const from = ctx.runStartedAt.toISOString();
  const window = `TimeGenerated between (datetime(${from}) .. now()) and ContainerAppName_s has 'lower'`;

  const drift = kql(`ContainerAppConsoleLogs_CL | where ${window} | where Log_s has 'History drift:' | project TimeGenerated, l=substring(extract(@'History drift:.*', 0, Log_s), 0, 200)`);
  if (drift == null) {
    ctx.report.record(S, 'lower logs', 'skip', 'az could not query the logs workspace (not signed in, or no Log Analytics Reader)');
    return;
  }
  // The barrage never sends a valid drift report itself, so ANY drift line in the window is a real
  // device finding a month whose fingerprint matched while its content did not.
  const driftRows = rows(drift);
  ctx.report.record(S, 'History drift canary: no "History drift:" in the window', driftRows.length ? 'fail' : 'pass',
    driftRows.length ? driftRows.map((r) => `${r.TimeGenerated ?? r[0]} ${r.l ?? r[1]}`).join('\n') : 'none');

  const errors = rows(kql(`ContainerAppConsoleLogs_CL | where ${window} | where Log_s has_any ('ERROR','WARN') | extend msg=replace_regex(substring(extract(@'(WARN|ERROR).*', 0, Log_s), 0, 200), @'\\[cid=[^\\]]*\\] \\[uid=[^\\]]*\\] 1 --- \\[backend\\] \\[[^\\]]*\\]\\s*', '') | extend msg=replace_regex(msg, @'[0-9]{3,}', 'N') | summarize n=count() by msg | order by n desc | take 25`));
  ctx.report.table('Backend warnings and errors in the window (ids folded to N)', ['Count', 'Message'],
    errors.map((r) => [String(r.n ?? r[1]), String(r.msg ?? r[0]).replace(/\|/g, '\\|').slice(0, 160)]));

  // Unhandled exceptions, minus what the harness itself causes: a tab closed mid-response, and the
  // DATETIME2 overflow api:abuse's year-9999 input provokes. Idempotency-key duplicates are the
  // outbox's safety net working (a replayed write racing its original) and happen daily on lower.
  const causes = rows(kql(`ContainerAppConsoleLogs_CL | where ${window} | where Log_s has 'Caused by' | extend c=substring(extract(@'Caused by: [^:]+(: [^\\n]{0,120})?', 0, Log_s), 0, 200) | where not(c has_any ('Broken pipe','ClientAbortException','AsyncRequestNotUsable','ServletOutputStream failed','duplicate key','out of range of values for the datetime2')) | summarize n=count() by c | order by n desc | take 15`));
  ctx.report.record(S, 'no unexpected exceptions (client aborts and idempotency-key duplicates excluded)', causes.length ? 'warn' : 'pass',
    causes.length ? causes.map((r) => `${r.n ?? r[1]}x ${r.c ?? r[0]}`).join('\n') : 'none');

  const slow = rows(kql(`ContainerAppConsoleLogs_CL | where ${window} | where Log_s has 'Slow History sync' | extend total=toint(extract(@'totalMs=([0-9]+)',1,Log_s)) | summarize n=count(), p50=percentile(total,50), p95=percentile(total,95), mx=max(total)`));
  const busy = rows(kql(`ContainerAppConsoleLogs_CL | where ${window} | where Log_s has 'History changed while it was being read' | count`));
  const s = slow[0] ?? {};
  ctx.report.record(S, 'History syncs over 500 ms (logged by the backend)', 'info',
    `${s.n ?? s[0] ?? 0} slow syncs; p50 ${s.p50 ?? s[1] ?? '-'} ms, p95 ${s.p95 ?? s[2] ?? '-'} ms, max ${s.mx ?? s[3] ?? '-'} ms; ` +
    `${busy[0]?.Count ?? busy[0]?.[0] ?? 0} "History changed while it was being read" 503s (the designed retry under concurrent writes)`);

  const cpu = dbCpu(ctx.runStartedAt, new Date());
  if (cpu?.length) {
    const max = Math.max(...cpu.map((p) => p.max ?? 0));
    const minutesAt100 = cpu.filter((p) => (p.max ?? 0) >= 99).length;
    ctx.report.record(S, 'lower database CPU during the run', 'info', `max ${max.toFixed(0)}%, ${minutesAt100} minute(s) at 99-100% (Basic, 5 DTU)`);
  }
}
