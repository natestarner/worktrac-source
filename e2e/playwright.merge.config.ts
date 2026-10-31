import { defineConfig } from '@playwright/test';

// For `npx playwright merge-reports --config playwright.merge.config.ts <blob dirs>` only: joins the
// blob reports of a suite split across runners (`--shard`, E2E_BLOB=1) back into the two outputs a
// single run produces -- the html report, and test-results/results.json, which is what flake
// history is measured from (see playwright.config.ts's reporter comment). Same paths, same format,
// so nothing that reads a lower run's artifacts can tell it was sharded.
export default defineConfig({
  testDir: './tests',
  reporter: [
    ['html', { open: 'never' }],
    ['json', { outputFile: 'test-results/results.json' }],
  ],
});
