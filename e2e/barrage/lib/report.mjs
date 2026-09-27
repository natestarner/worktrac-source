// Collects every check's outcome and writes report.md + results.json into the run directory
// (e2e/barrage-reports/<run id>/, gitignored). The console gets one line per check as it happens.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { log } from './config.mjs';

const ICON = { pass: 'PASS', fail: 'FAIL', skip: 'SKIP', warn: 'WARN', info: 'INFO' };

// Text made safe for one markdown table cell: backslashes first, so a `\` already in the text (a log
// line, a Windows path) can't swallow the escape added to a `|` after it and split the row.
export function mdCell(value, max = 200) {
  return String(value).split('\n')[0].replace(/\\/g, '\\\\').replace(/\|/g, '\\|').slice(0, max);
}

export class Report {
  constructor(dir, meta) {
    this.dir = dir;
    this.meta = meta;
    this.results = [];
    this.notes = [];
    this.tables = [];
    this.startedAt = new Date();
    mkdirSync(dir, { recursive: true });
    this.shotsDir = path.join(dir, 'screenshots');
    mkdirSync(this.shotsDir, { recursive: true });
  }

  // status: pass | fail | skip | warn | info
  record(suite, check, status, detail = '', extra = {}) {
    const row = { suite, check, status, detail, at: new Date().toISOString(), ...extra };
    this.results.push(row);
    log(`${ICON[status].padEnd(4)} [${suite}] ${check}${detail ? ` -- ${String(detail).split('\n')[0].slice(0, 220)}` : ''}`);
    return row;
  }

  note(text) {
    this.notes.push(text);
    log(`NOTE ${text}`);
  }

  // A small markdown table (e.g. timings) rendered under its own heading.
  table(title, header, rows) {
    this.tables.push({ title, header, rows });
    log(`TABLE ${title}\n${rows.map((r) => '     ' + r.join(' | ')).join('\n')}`);
  }

  counts() {
    const c = { pass: 0, fail: 0, skip: 0, warn: 0, info: 0 };
    for (const r of this.results) c[r.status] += 1;
    return c;
  }

  write() {
    const finishedAt = new Date();
    const c = this.counts();
    const lines = [];
    lines.push(`# Barrage report -- ${this.meta.target} -- ${this.meta.tier}`);
    lines.push('');
    lines.push(`- Run: \`${this.meta.runId}\`  (${this.startedAt.toISOString()} -> ${finishedAt.toISOString()}, ${Math.round((finishedAt - this.startedAt) / 60000)} min)`);
    for (const [k, v] of Object.entries(this.meta.build ?? {})) lines.push(`- ${k}: \`${v}\``);
    lines.push(`- Suites: ${this.meta.suites.join(', ')}`);
    lines.push(`- Engines: ${this.meta.engines.join(', ')}`);
    lines.push('');
    lines.push(`**${c.fail ? 'FAILURES' : 'No failures'}** -- ${c.pass} pass, ${c.fail} fail, ${c.warn} warn, ${c.skip} skip`);
    lines.push('');
    const failing = this.results.filter((r) => r.status === 'fail' || r.status === 'warn');
    if (failing.length) {
      lines.push('## Needs attention');
      lines.push('');
      for (const r of failing) {
        lines.push(`### ${r.status.toUpperCase()} [${r.suite}] ${r.check}`);
        lines.push('');
        lines.push('```');
        lines.push(String(r.detail).slice(0, 4000));
        lines.push('```');
        if (r.screenshot) lines.push(`![screenshot](${path.relative(this.dir, r.screenshot).replace(/\\/g, '/')})`);
        lines.push('');
      }
    }
    for (const t of this.tables) {
      lines.push(`## ${t.title}`);
      lines.push('');
      lines.push(`| ${t.header.join(' | ')} |`);
      lines.push(`|${t.header.map(() => '---').join('|')}|`);
      for (const row of t.rows) lines.push(`| ${row.join(' | ')} |`);
      lines.push('');
    }
    lines.push('## Every check');
    lines.push('');
    lines.push('| Suite | Check | Result | Detail |');
    lines.push('|---|---|---|---|');
    for (const r of this.results) {
      lines.push(`| ${r.suite} | ${r.check} | ${ICON[r.status]} | ${mdCell(r.detail)} |`);
    }
    lines.push('');
    if (this.notes.length) {
      lines.push('## Notes');
      lines.push('');
      for (const n of this.notes) lines.push(`- ${n}`);
      lines.push('');
    }
    writeFileSync(path.join(this.dir, 'report.md'), lines.join('\n'));
    writeFileSync(path.join(this.dir, 'results.json'), JSON.stringify({ meta: this.meta, startedAt: this.startedAt, finishedAt, counts: c, results: this.results, tables: this.tables, notes: this.notes }, null, 1));
    return path.join(this.dir, 'report.md');
  }
}
