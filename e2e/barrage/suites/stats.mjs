// api:stats-match -- the PRs board and Trends the device derives from History (statsFromHistory.js)
// equal what the server answers, on the target's REAL data: every person in the household, the PRs
// board, the overview and every logged exercise's records and trend at every range, in two zones
// whose days fall differently.
//
// The equivalence oracle (StatsFromHistoryCasesTest + statsFromHistory.test.js) proves this on
// generated Histories. This proves it where it matters: lower's own History, built by lower's own
// sync, from rows written by every path the app has, against lower's own StatsService. It imports
// the app's fold module itself (lib/frontendModule.mjs), so it checks the code the phone runs.
//
// The ONE accepted difference is the oracle's: on Free, the device holds 90 days, so a trend dot's
// record flag is judged within the window, and a workout on the floor's date but before its instant
// is plotted by the server only. Nothing else is tolerated.
import { isDeepStrictEqual } from 'node:util';
import { Device } from '../lib/device.mjs';
import { importFrontend } from '../lib/frontendModule.mjs';
import { log } from '../lib/config.mjs';

const S = 'api:stats-match';
const ZONES = ['America/New_York', 'Pacific/Auckland'];
const RANGES = [4, 12, 260]; // RangeToggle's RANGE_OPTIONS

// The first few paths where two JSON values differ, for a report a person can act on.
function differences(a, b, at = '', out = []) {
  if (out.length >= 5 || isDeepStrictEqual(a, b)) return out;
  if (a && b && typeof a === 'object' && typeof b === 'object' && Array.isArray(a) === Array.isArray(b)) {
    if (Array.isArray(a) && a.length !== b.length) out.push(`${at || '(root)'}: device has ${a.length} items, server ${b.length}`);
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) differences(a[k], b[k], `${at}${Array.isArray(a) ? `[${k}]` : `.${k}`}`, out);
    return out;
  }
  out.push(`${at || '(root)'}: device ${JSON.stringify(a)} / server ${JSON.stringify(b)}`);
  return out;
}

export async function statsMatch({ api, report }) {
  const fold = await importFrontend('utils/statsFromHistory.js');
  const people = await api.ok('GET', '/api/people');
  const tally = { checked: 0, differ: [] };

  const check = (label, device, server) => {
    tally.checked += 1;
    const diffs = differences(device, server);
    if (diffs.length) tally.differ.push(`${label}: ${diffs.join('; ')}`);
  };

  for (const person of people) {
    const P = person.id;
    const device = new Device(api, `stats-match-${P}`, P);
    await device.sync({ full: true });
    const sessions = Object.values(device.months).flatMap((m) => m.sessions);
    if (!sessions.length) { log(`${S}: ${person.name} has no History, skipped`); continue; }
    const digests = fold.historyDigests({ format: 2, months: device.months, checked: {} });
    const window = await api.ok('GET', `/api/people/${P}/history-window`);
    const free = window?.windowStart != null;
    const held = new Set(sessions.map((s) => s.id));
    const forDevice = (points) => (free ? points.filter((p) => held.has(p.sessionId)).map(({ isPr: _isPr, ...rest }) => rest) : points);
    const exerciseIds = [...new Set(sessions.flatMap((s) => s.entries.map((e) => e.exerciseId)))].sort((a, b) => a - b);
    const who = `${person.name} (${free ? 'Free' : 'full History'})`;
    log(`${S}: ${who}: ${sessions.length} workouts, ${exerciseIds.length} exercises`);

    check(`${who} PRs board`, fold.prBoard(digests), await api.ok('GET', `/api/people/${P}/prs`));
    for (const zone of ZONES) {
      const z = encodeURIComponent(zone);
      for (const weeks of RANGES) {
        const server = await api.ok('GET', `/api/people/${P}/trends/overview?weeks=${weeks}&zone=${z}`);
        const mine = fold.trendsOverview(digests, { weeks, zone, now: Date.now(), hiddenSessions: window?.hiddenSessions ?? 0 });
        check(`${who} overview ${weeks}wk ${zone}`, mine, server);
      }
      for (const id of exerciseIds) {
        const records = await api.ok('GET', `/api/people/${P}/exercises/${id}/records?zone=${z}`);
        check(`${who} exercise ${id} records ${zone}`, fold.exerciseRecords(digests, id, { zone }), records);
        for (const weeks of RANGES) {
          const server = await api.ok('GET', `/api/people/${P}/trends/exercises/${id}?weeks=${weeks}&zone=${z}`);
          const mine = fold.exerciseTrend(digests, id, { weeks, zone, now: Date.now(), windowStart: window?.windowStart ?? null });
          check(`${who} exercise ${id} trend ${weeks}wk ${zone}`, forDevice(mine), forDevice(server));
        }
      }
    }
  }

  if (tally.checked === 0) {
    report.record(S, 'device-derived PRs and Trends equal the server', 'fail', 'nothing was checked: no person had History');
    return;
  }
  report.record(S, 'device-derived PRs and Trends equal the server', tally.differ.length ? 'fail' : 'pass',
    tally.differ.length
      ? `${tally.differ.length} of ${tally.checked} answers differ. ${tally.differ.slice(0, 8).join(' | ')}`
      : `${tally.checked} answers compared (PRs board, overview, every logged exercise's records and trend at ${RANGES.join('/')} weeks, in ${ZONES.join(' and ')}), all equal`);
}
