import { APIRequestContext, Page, expect } from '@playwright/test';
import { waitForOutboxDrain } from './offline';

// The History sync's promise, checked at the end of every parity spec: once connectivity is back and
// the outbox has drained, the History the APP holds -- what every screen reads -- is exactly what the
// server says, for every person it holds History for. A device can lag while degraded; it must
// never stay behind, out of sync or wrong afterwards.
//
// It opens History the way a person would (mounting the tab refreshes whatever a write invalidated)
// and then reads the app's PERSISTED query cache -- the copy that survives a reload, and the one a
// wrong-but-trusted month would live in -- polling past the persister's 1s throttle.
//
// Not a connectivity branch and not sync chrome: it asserts the result, in every mode alike.
export async function expectHistoryMatchesServer(page: Page, request: APIRequestContext) {
  // A PR celebration left up by the spec would sit over the tab bar.
  const celebration = page.getByText('New PR!');
  if (await celebration.isVisible()) {
    await celebration.click({ force: true });
    await expect(celebration).toBeHidden();
  }
  // Every sync the app makes from here on, for the failure message: "the app never asked" and "the
  // app asked and was told the wrong thing" are different bugs, and this is what tells them apart.
  const syncLog: string[] = [];
  page.on('response', async (r) => {
    if (!/\/history\/sync$/.test(r.url())) return;
    const sent = JSON.parse(r.request().postData() ?? '{}');
    const reply = await r.json().catch(() => null);
    syncLog.push(`${r.status()} held=${JSON.stringify(Object.keys(sent.have ?? {}))} `
      + `changed=${JSON.stringify(Object.keys(reply?.changed ?? {}))} months=${JSON.stringify(reply?.months ?? null)}`);
  });

  // The tab bar's link specifically -- the Help page (where a spec may end) links to its own
  // "History" section too. Drain AFTER moving: the drain helper matches "waiting to sync", which is
  // also Help page prose.
  // Retried, because a spec can end mid-navigation: closing the tour (started from the Help page)
  // routes back to Help a beat later, which would land after a single click here.
  await expect(async () => {
    await page.getByLabel('Sections').getByRole('link', { name: 'History' }).click();
    await expect(page).toHaveURL(/\/app\/history/, { timeout: 2000 });
    await expect(page.getByRole('heading', { name: 'Huddle Handbook' })).toHaveCount(0, { timeout: 2000 });
  }).toPass({ timeout: 15000 });
  await waitForOutboxDrain(page);

  const { apiUrl } = await (await request.get('/config.json')).json();
  const token = await page.evaluate(() => localStorage.getItem('workout-tracker-token'));
  const headers = { Authorization: `Bearer ${token}` };

  let detail = '';
  try {
    await expect.poll(
      async () => {
        const held = await persistedHistories(page);
        const people = Object.keys(held);
        if (people.length === 0) {
          detail = 'no History in the persisted cache yet';
          return false;
        }
        for (const personId of people) {
          const truth = await (await request.get(`${apiUrl}/api/people/${personId}/history`, { headers })).json();
          if (JSON.stringify(truth) !== JSON.stringify(held[personId])) {
            detail = `person ${personId}\n  app:    ${JSON.stringify(held[personId])}\n  server: ${JSON.stringify(truth)}`;
            return false;
          }
        }
        return true;
      },
      { timeout: 20000 },
    ).toBe(true);
  } catch {
    throw new Error(`The app's History never matched the server's after reconnecting (20s): ${detail}\n`
      + `syncs the app made after reconnecting:\n  ${syncLog.join('\n  ') || '(none -- the app never asked)'}`);
  }
}

// Replaces every person's persisted History with the flat array a build from before the sync
// stored, plus `marker` -- a workout the server has never heard of, so a spec can tell "the old copy
// is what rendered" from "the sync replaced it". The query cache is one JSON string under
// 'worktrac-query-cache' in idb-keyval's store. Call it with nothing running that could persist over
// it (offline, or from a same-origin page that is not the app).
export async function rewritePersistedHistoryAsOldFormat(page: Page, marker: object) {
  const rewritten = await page.evaluate(
    (extra) =>
      new Promise<number>((resolve, reject) => {
        const open = indexedDB.open('keyval-store');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const store = open.result.transaction('keyval', 'readwrite').objectStore('keyval');
          const get = store.get('worktrac-query-cache');
          get.onerror = () => reject(get.error);
          get.onsuccess = () => {
            const persisted = JSON.parse(get.result);
            let count = 0;
            for (const query of persisted.clientState.queries) {
              if (query.queryKey[0] !== 'history' || !query.state?.data?.months) continue;
              const months = query.state.data.months as Record<string, { sessions: unknown[] }>;
              const flat = Object.keys(months).sort().reverse().flatMap((m) => months[m].sessions);
              query.state.data = [...flat, extra];
              count += 1;
            }
            const put = store.put(JSON.stringify(persisted), 'worktrac-query-cache');
            put.onerror = () => reject(put.error);
            put.onsuccess = () => resolve(count);
          };
        };
      }),
    marker,
  );
  expect(rewritten, 'a synced History entry to rewrite').toBeGreaterThan(0);
}

// A workout only an old-format cache could contain -- see rewritePersistedHistoryAsOldFormat.
export const LEGACY_MARKER_WORKOUT = {
  id: 987654321,
  startedAt: '2026-01-10T10:00:00Z',
  endedAt: '2026-01-10T11:00:00Z',
  manual: true,
  entries: [{ exerciseId: 1, exerciseName: 'Legacy Marker Press', sets: [{ weight: 42, reps: 7, durationSeconds: null, unit: 'lb' }], note: null }],
};

// personId -> the flat, newest-first History the app would render (lib/historySync.js#flattenHistory),
// read straight from the persisted query cache in IndexedDB.
async function persistedHistories(page: Page): Promise<Record<string, unknown[]>> {
  return page.evaluate(
    () =>
      new Promise<Record<string, unknown[]>>((resolve) => {
        const open = indexedDB.open('keyval-store');
        open.onerror = () => resolve({});
        open.onsuccess = () => {
          try {
            const get = open.result.transaction('keyval', 'readonly').objectStore('keyval').get('worktrac-query-cache');
            get.onerror = () => resolve({});
            get.onsuccess = () => {
              if (!get.result) return resolve({});
              const persisted = JSON.parse(get.result);
              const out: Record<string, unknown[]> = {};
              for (const query of persisted.clientState?.queries ?? []) {
                if (query.queryKey?.[0] !== 'history' || query.queryKey.length !== 2) continue;
                const data = query.state?.data;
                if (Array.isArray(data)) {
                  out[String(query.queryKey[1])] = data;
                } else if (data?.months) {
                  const months = data.months as Record<string, { sessions: unknown[] }>;
                  out[String(query.queryKey[1])] = Object.keys(months).sort().reverse().flatMap((m) => months[m].sessions);
                }
              }
              resolve(out);
            };
          } catch {
            resolve({});
          }
        };
      }),
  );
}
