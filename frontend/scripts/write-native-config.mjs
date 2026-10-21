// SPIKE: CI deletes config.json from the web artifact and the deploy injects it, but an app has no
// deploy step -- so the native build bakes the API origin in as a local file that can never fail
// to load. Defaults to lower; NATIVE_API_URL overrides.
import { writeFileSync } from 'node:fs';

const apiUrl =
  process.env.NATIVE_API_URL ||
  'https://worktrac-backend-lower.whitehill-3dc27bb3.eastus.azurecontainerapps.io';

writeFileSync(new URL('../dist/config.json', import.meta.url), JSON.stringify({ apiUrl }, null, 2) + '\n');
console.log(`dist/config.json -> ${apiUrl}`);
