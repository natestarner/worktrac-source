#!/usr/bin/env node
// Turn a Playwright `json` reporter file into a GitHub step summary.
//
// Why this exists: CI runs with `retries: 2`, so a test that fails and then passes is recorded
// `flaky` while the run still reports success. The Actions UI shows a green check either way, so
// a suite can degrade for weeks with nothing on screen ever saying so -- measured 2026-08-14, 38
// of the 42 green lower runs then retained contained at least one flaky test. Storing that in an
// artifact is necessary but not sufficient: an artifact nobody downloads is not a signal. This
// prints it on the run page instead, where it is seen without being looked for.
//
// Deliberately read-only and dependency-free. It never fails the job: an unreadable or missing
// results file means the tests told us nothing extra, not that the run is broken.
//
// Usage: node scripts/flake-summary.mjs [path-to-results.json]   (writes markdown to stdout)

import { readFileSync } from 'node:fs';

// Playwright colourises error messages, so the raw string carries ANSI escapes (ESC[2m, ESC[31m)
// that render as literal noise in a markdown table. Built from a char code rather than written
// as an escape sequence so no invisible control byte ever lands in this file.
const ANSI = new RegExp(String.fromCharCode(27) + String.raw`[[0-9;]*m`, 'g');

const resultsPath = process.argv[2] ?? 'test-results/results.json';

let report;
try {
  report = JSON.parse(readFileSync(resultsPath, 'utf8'));
} catch (err) {
  // No results file at all usually means the run died before Playwright could write one (the
  // wait-for-url gates failing, an install step erroring). Say so plainly rather than pretending
  // a clean result.
  console.log('### E2E results\n');
  console.log(`Could not read \`${resultsPath}\` (${err.code ?? err.message}) — no per-test outcomes to report.`);
  process.exit(0);
}

// The json reporter nests describe blocks as `suites` inside the file-level suite, so specs have
// to be gathered recursively -- a flat pass over the top level silently misses every test inside
// a `test.describe`, which in this suite is nearly all of them.
function collectSpecs(suite, ancestors = []) {
  const titles = suite.title ? [...ancestors, suite.title] : ancestors;
  const out = [];
  for (const spec of suite.specs ?? []) out.push({ spec, titles });
  for (const child of suite.suites ?? []) out.push(...collectSpecs(child, titles));
  return out;
}

// Pipe characters and newlines would break out of the markdown table cell they sit in.
function esc(s) {
  return String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

function stripAnsi(s) {
  return String(s ?? '').replace(ANSI, '');
}

const specs = (report.suites ?? []).flatMap((s) => collectSpecs(s));

const flaky = [];
const failed = [];
for (const { spec, titles } of specs) {
  for (const test of spec.tests ?? []) {
    // `titles[0]` is the spec file; the rest are describe blocks.
    const [file, ...describes] = titles;
    const name = [...describes, spec.title].join(' › ');
    const attempts = (test.results ?? []).length;
    // First non-empty error across attempts -- the last attempt of a flaky test passed, so its
    // own error list is empty and reading only that would report no reason at all.
    const error = (test.results ?? [])
      .flatMap((r) => (r.error?.message ? [r.error.message] : []))
      .find(Boolean);
    const firstLine = error
      ? stripAnsi(error).split('\n')[0].replace(/\s+/g, ' ').slice(0, 160)
      : '';

    if (test.status === 'flaky') flaky.push({ file, name, attempts, firstLine });
    else if (test.status === 'unexpected') failed.push({ file, name, attempts, firstLine });
  }
}

const stats = report.stats ?? {};
const lines = [];
lines.push('### E2E results');
lines.push('');
lines.push(
  `**${stats.expected ?? 0} passed · ${flaky.length} flaky · ${failed.length} failed · ${stats.skipped ?? 0} skipped**`
);
lines.push('');

if (failed.length) {
  lines.push('#### Failed (every attempt)');
  lines.push('');
  lines.push('| Test | File | Error |');
  lines.push('|---|---|---|');
  for (const t of failed) lines.push(`| ${esc(t.name)} | \`${esc(t.file)}\` | ${esc(t.firstLine)} |`);
  lines.push('');
}

if (flaky.length) {
  lines.push('#### Flaky (failed, then passed on retry)');
  lines.push('');
  lines.push('These did **not** turn the run red. They are the early warning.');
  lines.push('');
  lines.push('| Test | File | Attempts | First error |');
  lines.push('|---|---|---|---|');
  for (const t of flaky) {
    lines.push(`| ${esc(t.name)} | \`${esc(t.file)}\` | ${t.attempts} | ${esc(t.firstLine)} |`);
  }
  lines.push('');
}

if (!flaky.length && !failed.length) {
  lines.push('No flaky or failed tests in this run.');
  lines.push('');
}

lines.push(
  '_Per-test outcomes are in the `e2e-results-json` artifact. A green run can still contain flakes — see `.claude/rules/e2e-tests.md`._'
);

console.log(lines.join('\n'));
