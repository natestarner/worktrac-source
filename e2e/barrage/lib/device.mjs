// A simulated device holding History exactly as the app's cache does ({ 'yyyy-mm': { fp, sessions } })
// and applying /history/sync replies with the same rules as frontend/src/lib/historySync.js
// #applyHistorySync. The truth it is compared with is GET /history: the same builder, flattened.
import { sleep } from './config.mjs';

export class Mismatch extends Error {}

export class Device {
  constructor(api, name, personId = api.personId) {
    this.api = api;
    this.name = name;
    this.personId = personId;
    this.months = null;
    this.syncs = 0;
    this.retried503 = 0;
  }

  // scope: { sessions, at } for a scoped sync (as the app sends after a write on this device).
  async sync({ scope = null, full = false, retries = 3 } = {}) {
    const held = full || !this.months ? null : this.months;
    const body = { have: Object.fromEntries(Object.entries(held ?? {}).map(([m, v]) => [m, v.fp])) };
    if (held && scope) Object.assign(body, scope);
    let reply;
    let ms = 0;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      const r = await this.api.sync(body, this.personId);
      this.syncs += 1;
      ms = r.ms;
      if (r.status === 503) { this.retried503 += 1; await sleep(300 * (attempt + 1)); continue; }
      if (r.status !== 200) throw new Error(`${this.name}: sync -> ${r.status} ${String(r.body).slice(0, 120)}`);
      reply = r.body;
      break;
    }
    if (!reply) throw new Error(`${this.name}: 503 on every attempt`);
    const scoped = Array.isArray(reply.scope);
    if (scoped && !held) throw new Mismatch(`${this.name}: scoped reply to a device holding nothing`);
    const next = {};
    if (scoped) for (const [m, v] of Object.entries(held)) if (!reply.scope.includes(m)) next[m] = v;
    for (const m of reply.months) {
      const sent = reply.changed?.[m];
      if (sent) next[m] = sent;
      else if (held?.[m]) next[m] = held[m];
      else throw new Mismatch(`${this.name}: listed ${m} without sending it`);
    }
    // The drift canary, as the app runs it on a full sync: same fingerprint, different content.
    if (!held && this.months) {
      for (const [m, sent] of Object.entries(reply.changed ?? {})) {
        const old = this.months[m];
        if (old && old.fp === sent.fp && canon(old.sessions) !== canon(sent.sessions)) throw new Mismatch(`${this.name}: DRIFT in ${m}`);
      }
    }
    this.months = next;
    return { reply, ms };
  }

  flat() {
    return Object.keys(this.months ?? {}).sort().reverse().flatMap((m) => this.months[m].sessions);
  }

  clone(name) {
    const d = new Device(this.api, name, this.personId);
    d.months = JSON.parse(JSON.stringify(this.months));
    return d;
  }
}

export function canon(sessions) {
  return JSON.stringify(sessions, (_k, v) => (v && typeof v === 'object' && !Array.isArray(v)
    ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, v[k]]))
    : v));
}

export function describeDiff(got, want) {
  const a = new Map(got.map((s) => [s.id, canon([s])]));
  const b = new Map(want.map((s) => [s.id, canon([s])]));
  const onlyDevice = [...a.keys()].filter((k) => !b.has(k)).slice(0, 5);
  const onlyTruth = [...b.keys()].filter((k) => !a.has(k)).slice(0, 5);
  const differing = [...a.keys()].filter((k) => b.has(k) && a.get(k) !== b.get(k)).slice(0, 5);
  const order = got.map((s) => s.id).join() !== want.map((s) => s.id).join();
  return `device-only=${JSON.stringify(onlyDevice)} truth-only=${JSON.stringify(onlyTruth)} differing=${JSON.stringify(differing)} order-differs=${order}`;
}

// Throws unless the device equals the truth -- for `months` (a scoped reply's scope), only those.
export function expectEqual(device, truth, label, months = null) {
  let got = device.flat();
  let want = truth;
  if (months) {
    const pick = (xs) => xs.filter((s) => months.includes(s.startedAt.slice(0, 7)));
    got = pick(got);
    want = pick(want);
  }
  if (canon(got) !== canon(want)) throw new Mismatch(`[${label}] ${device.name} != GET /history: ${describeDiff(got, want)}`);
}
