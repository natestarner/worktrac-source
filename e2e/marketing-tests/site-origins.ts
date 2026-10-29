import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// The origins a page under test should have been filled with (scripts/fill-site-origins.sh).
//
// The deployed hosts are written out here on purpose: they are the test's own oracle, kept apart
// from the deploy config it is checking, so a wrong value in config/<env>/site-origins.env fails
// instead of being read back and agreed with. A local preview has no fixed host, so it reads the
// same env file CI filled it from.
export type SiteOrigins = { site: string; app: string; robots: string };

const PRODUCTION: SiteOrigins = {
  site: 'https://huddle.fitness',
  app: 'https://app.huddle.fitness',
  robots: 'index, follow',
};

const DEPLOYED: Record<string, SiteOrigins> = {
  'huddle.fitness': PRODUCTION,
  'www.huddle.fitness': PRODUCTION,
  'dev.huddle.fitness': {
    site: 'https://dev.huddle.fitness',
    app: 'https://app.dev.huddle.fitness',
    robots: 'noindex, nofollow',
  },
};

export function expectedOrigins(pageUrl: string): SiteOrigins {
  const deployed = DEPLOYED[new URL(pageUrl).hostname];
  if (deployed) return deployed;

  const env = readFileSync(join(__dirname, '..', '..', 'scripts', 'site-origins.local.env'), 'utf8');
  const read = (key: string) => env.match(new RegExp(`^${key}=(.*)$`, 'm'))?.[1].trim() ?? '';
  return { site: read('SITE_ORIGIN'), app: read('APP_ORIGIN'), robots: read('SITE_ROBOTS') };
}
