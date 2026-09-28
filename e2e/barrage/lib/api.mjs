// A small HTTP client for the backend: login, the History endpoints, and the writes the barrage
// drives. Every call reports status, body and elapsed time; `ok()` throws on anything but 2xx.
// Node's fetch decompresses gzip itself, so History comes back as plain JSON.
import { sleep } from './config.mjs';

export class Api {
  constructor(base, { token = null, testSupportKey = null } = {}) {
    this.base = base;
    this.token = token;
    this.testSupportKey = testSupportKey;
    this.personId = null;
  }

  async req(method, path, body, { timeoutMs = 120000, headers = {} } = {}) {
    const started = performance.now();
    try {
      const res = await fetch(this.base + path, {
        method,
        headers: {
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
          ...(this.testSupportKey ? { 'X-E2E-Test-Key': this.testSupportKey } : {}),
          ...headers,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
      const text = await res.text();
      let parsed = text;
      if (text && (text[0] === '{' || text[0] === '[')) {
        try { parsed = JSON.parse(text); } catch { /* keep text */ }
      }
      return { status: res.status, body: parsed, ms: performance.now() - started, bytes: text.length };
    } catch (error) {
      // A timeout or a dropped connection: what a client sees mid-deploy or on a saturated server.
      return { status: 0, body: String(error?.name || error), ms: performance.now() - started, error };
    }
  }

  async ok(method, path, body, options) {
    const r = await this.req(method, path, body, options);
    if (r.status < 200 || r.status >= 300) {
      throw new Error(`${method} ${path} -> ${r.status} ${typeof r.body === 'string' ? r.body.slice(0, 200) : JSON.stringify(r.body).slice(0, 200)}`);
    }
    return r.body;
  }

  static async login(base, email, password) {
    const api = new Api(base);
    for (let attempt = 0; attempt < 4; attempt += 1) {
      // A cold lower backend holds the first connection ~35s.
      const r = await api.req('POST', '/api/auth/login', { email, password }, { timeoutMs: 90000 });
      if (r.status === 200) {
        api.token = r.body.token;
        api.personId = r.body.person?.id ?? null;
        return api;
      }
      if (r.status && r.status < 500) throw new Error(`login refused: ${r.status}`);
      await sleep(5000);
    }
    throw new Error('login failed: backend unreachable');
  }

  truth(personId = this.personId) {
    return this.ok('GET', `/api/people/${personId}/history`, undefined, { timeoutMs: 180000 });
  }

  sync(body, personId = this.personId, options = {}) {
    return this.req('POST', `/api/people/${personId}/history/sync`, body, { timeoutMs: 180000, ...options });
  }

  async exerciseId(name) {
    this._catalog ??= await this.ok('GET', '/api/exercises');
    const found = this._catalog.find((e) => e.name === name);
    if (!found) throw new Error(`exercise not in catalog: ${name}`);
    return found.id;
  }

  setsOf(sessionId, exerciseId) {
    return this.ok('GET', `/api/sessions/${sessionId}/sets?exerciseId=${exerciseId}`);
  }
}
