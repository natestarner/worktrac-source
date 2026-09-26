// Targets, credentials and run-wide settings for the barrage (see ../README.md).
//
// Credentials NEVER live in the repo. For lower they come from the environment (BARRAGE_EMAIL /
// BARRAGE_PASSWORD) or from ~/.worktrac/barrage.env, a KEY=VALUE file outside the repo. For local,
// the barrage registers its own throwaway account through the test-support endpoint instead.
import { existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const BARRAGE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const E2E_DIR = path.resolve(BARRAGE_DIR, '..');
export const REPO_ROOT = path.resolve(E2E_DIR, '..');

export const LOWER = {
  name: 'lower',
  app: 'https://app.dev.huddle.fitness',
  api: 'https://worktrac-backend-lower.whitehill-3dc27bb3.eastus.azurecontainerapps.io',
  containerApp: 'worktrac-backend-lower',
  resourceGroup: 'worktrac-rg',
  sqlServer: 'worktrac-sql-server',
  database: 'worktrac-db-lower',
  logWorkspace: 'ed5b43a9-96fa-4194-9fb4-0d4b7932a86a', // docs/azure-read-only-access.md
};

// The local stack of THIS worktree: scripts/worktree-env.sh writes the ports to .env.worktree.
export function localTarget() {
  const env = readKeyValueFile(path.join(REPO_ROOT, '.env.worktree'));
  const fe = process.env.FRONTEND_PORT || env.FRONTEND_PORT || '3000';
  const be = process.env.BACKEND_PORT || env.BACKEND_PORT || '8080';
  return { name: 'local', app: `http://localhost:${fe}`, api: `http://localhost:${be}`, frontendPort: fe, backendPort: be };
}

export function readKeyValueFile(file) {
  if (!existsSync(file)) return {};
  const out = {};
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*"?([^"]*)"?\s*$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

export const CREDENTIALS_FILE = path.join(os.homedir(), '.worktrac', 'barrage.env');

// The lower account the barrage runs against. It must be a DEDICATED test account seeded with
// years of History (`--seed` does that once); the barrage writes to it and cleans up after itself.
export function lowerCredentials() {
  const file = readKeyValueFile(CREDENTIALS_FILE);
  const email = process.env.BARRAGE_EMAIL || file.BARRAGE_EMAIL;
  const password = process.env.BARRAGE_PASSWORD || file.BARRAGE_PASSWORD;
  if (!email || !password) {
    throw new Error(
      `No lower credentials. Set BARRAGE_EMAIL and BARRAGE_PASSWORD, or put them in ${CREDENTIALS_FILE} ` +
        '(outside the repo -- never commit them).',
    );
  }
  return { email, password };
}

// application-local.yml's test-support key: local only, used to register throwaway accounts.
export function localTestSupportKey() {
  if (process.env.E2E_TEST_SUPPORT_KEY) return process.env.E2E_TEST_SUPPORT_KEY;
  const yml = path.join(REPO_ROOT, 'backend', 'src', 'main', 'resources', 'application-local.yml');
  const m = existsSync(yml) && readFileSync(yml, 'utf8').match(/test-support-key:\s*"?([^"\s]+)"?/);
  if (!m) throw new Error('No E2E_TEST_SUPPORT_KEY and none found in application-local.yml');
  return m[1];
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export const stamp = () => new Date().toISOString().slice(11, 19);
export const log = (...args) => console.log(stamp(), ...args);
