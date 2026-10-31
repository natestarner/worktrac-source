// Which spec FILES a change since <base> touches, for scripts/select-changed-e2e.sh. Prints one
// path per line relative to e2e/ (tests/x.spec.ts), or the single line ALL when the whole suite is
// affected, or nothing.
//
// Why not Playwright's `--only-changed`: it attributes a test to the file where `test()` was
// CALLED, and every parity spec's tests are called inside support/parity.ts's
// forEachConnectivityMode. So a changed parity spec selected none of its parity tests -- measured on
// the first real run (2026-10-31): 2 of the changed file's 6 tests. Parity specs are how this
// suite covers user-visible flows, so that is most of what a new feature adds. Selecting FILES and
// passing them to `playwright test <files>` includes every test a file defines, wherever test() is
// called.
//
// A file is affected when it changed, or when it imports (directly or through other helpers) a
// file that changed. A changed non-TypeScript file under e2e/tests (a fixture) affects every file
// that names it. A change to what every test runs under -- the Playwright config or the e2e
// packages -- affects everything.
//
//   node e2e/scripts/changed-specs.mjs <base-commit>      (run from anywhere in the repo)
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const base = process.argv[2];
if (!base) {
  console.error('usage: changed-specs.mjs <base-commit>');
  process.exit(2);
}

const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const e2e = path.join(root, 'e2e');
const testsDir = path.join(e2e, 'tests');

// Deleted files can't be run, so --diff-filter=d (everything except deletions).
const changed = execFileSync('git', ['diff', '--name-only', '--diff-filter=d', base, 'HEAD', '--', 'e2e'], {
  cwd: root,
  encoding: 'utf8',
})
  .split('\n')
  .filter(Boolean)
  .map((p) => path.join(root, p));

const EVERYTHING = ['playwright.config.ts', 'package.json', 'package-lock.json', 'tsconfig.json'].map((f) =>
  path.join(e2e, f),
);
if (changed.some((f) => EVERYTHING.includes(f))) {
  console.log('ALL');
  process.exit(0);
}

const walk = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = path.join(dir, d.name);
    return d.isDirectory() ? walk(p) : [p];
  });
const tsFiles = walk(testsDir).filter((f) => f.endsWith('.ts'));
const source = new Map(tsFiles.map((f) => [f, fs.readFileSync(f, 'utf8')]));

// file -> the local files it imports (relative specifiers only; packages can't change here)
const importsOf = new Map();
for (const [file, text] of source) {
  const deps = [];
  for (const m of text.matchAll(/(?:from\s+|import\(\s*)['"](\.{1,2}\/[^'"]+)['"]/g)) {
    const target = path.resolve(path.dirname(file), m[1]);
    const resolved = [target, `${target}.ts`, path.join(target, 'index.ts')].find((c) => source.has(c));
    if (resolved) deps.push(resolved);
  }
  importsOf.set(file, deps);
}

const affected = new Set(changed.filter((f) => source.has(f)));
// A changed fixture (any non-TS file under tests/) affects every file that names it.
for (const fixture of changed.filter((f) => f.startsWith(testsDir + path.sep) && !f.endsWith('.ts'))) {
  const name = path.basename(fixture);
  for (const [file, text] of source) if (text.includes(name)) affected.add(file);
}
// Close over importers until nothing new is added.
for (let grew = true; grew; ) {
  grew = false;
  for (const [file, deps] of importsOf) {
    if (!affected.has(file) && deps.some((d) => affected.has(d))) {
      affected.add(file);
      grew = true;
    }
  }
}

for (const f of [...affected].filter((f) => f.endsWith('.spec.ts')).sort()) {
  console.log(path.relative(e2e, f).split(path.sep).join('/'));
}
