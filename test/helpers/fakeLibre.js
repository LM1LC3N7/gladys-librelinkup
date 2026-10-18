// -----------------------------------------------------------------------------
// A fake LibreLinkUp API (in memory): the login (with its redirect to a
// region, its steps) and the list of connections. The shapes come from
// pylibrelinkup 0.11.2 (MIT, models/ and its tests); never checked against a
// real account (TODO.md). Every name, id and value is made up.
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto';
import { CODES, LibreError } from '../../src/llu/errors.js';

export const EMAIL = 'someone@example.org';
export const PASSWORD = 's3cr3t-Pa55';
export const USER_ID = 'a1b2c3d4-0000-4000-8000-00000000user';
export const ALICE = '11111111-2222-4333-8444-555555555555';
export const BOB = '66666666-7777-4888-9999-000000000000';

/** The `FactoryTimestamp` format of the API: "10/18/2026 7:58:00 AM" (UTC). */
export function factory(ms) {
  const d = new Date(ms);
  const h = d.getUTCHours();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}/${d.getUTCFullYear()} ${h % 12 || 12}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} ${h < 12 ? 'AM' : 'PM'}`;
}

export function measurement(ms, mgdl, trend = 3, extra = {}) {
  return {
    FactoryTimestamp: factory(ms),
    Timestamp: '10/18/2026 9:59:00 AM',
    type: 1,
    ValueInMgPerDl: mgdl,
    TrendArrow: trend,
    TrendMessage: null,
    MeasurementColor: 1,
    GlucoseUnits: 1,
    Value: mgdl,
    isHigh: false,
    isLow: false,
    ...extra,
  };
}

export function connection(patientId, firstName, lastName, glucose, extra = {}) {
  return {
    id: `c-${patientId}`,
    patientId,
    country: 'FR',
    status: 2,
    firstName,
    lastName,
    targetLow: 70,
    targetHigh: 180,
    uom: 1,
    sensor: { deviceId: '', sn: 'XYZ', a: 1, w: 60, pt: 4, s: false, lj: false },
    alarmRules: { c: true, h: { th: 250, thmm: 13.9, d: 1440, f: 0.1 } },
    glucoseMeasurement: glucose,
    glucoseItem: glucose,
    glucoseAlarm: null,
    patientDevice: { did: 'x', dtid: 40068, v: '3.3.1', alarms: false },
    created: 1700000000,
    ...extra,
  };
}

export function createFakeLibre({ now }) {
  const fake = {
    requests: [],
    /** The region the global host sends the account to (null: none). */
    region: 'eu',
    /** A step the login asks (`tou`, `pp`...), or null. */
    step: null,
    connections: [
      connection(ALICE, 'Alice', 'Martin', measurement(now() - 60_000, 110, 3)),
      connection(BOB, 'Bob', 'Durand', measurement(now() - 120_000, 150, 4), {
        targetLow: 0,
        targetHigh: 0,
      }),
    ],
    /** Tokens given so far; the last one is valid. */
    tokens: [],
    tokenLifeMs: 180 * 24 * 3600_000,
    /** A new ticket given with the list (token rotation), or null. */
    rotate: false,
    /** { status, headers, body, path, host } answered once each (FIFO). */
    failures: [],
    unreachable: false,
    gate: null,
    inFlight: 0,
    maxInFlight: 0,
  };

  const json = (status, value, headers = {}) => ({
    status,
    headers: { 'content-type': 'application/json', ...headers },
    body: Buffer.from(JSON.stringify(value)),
  });
  const expiries = new Map();
  const newToken = () => {
    const token = `token-${fake.tokens.length + 1}`;
    fake.tokens.push(token);
    expiries.set(token, Math.floor((now() + fake.tokenLifeMs) / 1000));
    return { token, expires: expiries.get(token), duration: 1 };
  };

  function answer(url, options, headers) {
    const index = fake.failures.findIndex(
      (f) => (!f.path || url.pathname.startsWith(f.path)) && (!f.host || url.host === f.host),
    );
    if (index >= 0) {
      const [f] = fake.failures.splice(index, 1);
      if (f.body !== undefined) {
        const body = typeof f.body === 'string' ? f.body : JSON.stringify(f.body);
        return { status: f.status, headers: f.headers ?? {}, body: Buffer.from(body) };
      }
      return json(f.status, { status: f.status, error: { message: 'failure' } }, f.headers ?? {});
    }
    if (headers.product !== 'llu.android' || headers.version !== '4.16.0') {
      return json(403, { status: 920, data: { minimumVersion: '4.16.0' } });
    }
    if (url.pathname === '/llu/auth/login' && options.method === 'POST') {
      const body = JSON.parse(String(options.body));
      if (url.host === 'api.libreview.io' && fake.region) {
        return json(200, { status: 0, data: { redirect: true, region: fake.region } });
      }
      if (body.email !== EMAIL || body.password !== PASSWORD) {
        return json(200, { status: 2, error: { message: 'notAuthenticated' } });
      }
      if (fake.step) {
        return json(200, {
          status: 4,
          data: {
            step: { type: fake.step, componentName: 'AcceptDocument' },
            authTicket: newToken(),
          },
        });
      }
      return json(200, {
        status: 0,
        data: {
          user: { id: USER_ID, firstName: 'Some', lastName: 'One', email: EMAIL },
          messages: { unread: 0 },
          notifications: { unresolved: 0 },
          authTicket: newToken(),
          invitations: [],
        },
      });
    }
    if (url.pathname === '/llu/connections' && options.method === 'GET') {
      const valid = `Bearer ${fake.tokens.at(-1)}`;
      const accountId = createHash('sha256').update(USER_ID).digest('hex');
      if (!fake.tokens.length || headers.authorization !== valid) {
        return json(401, { message: 'InvalidCredentials' });
      }
      if (headers['account-id'] !== accountId) {
        return json(401, { message: 'InvalidCredentials' });
      }
      const ticket = fake.rotate
        ? newToken()
        : { token: fake.tokens.at(-1), expires: expiries.get(fake.tokens.at(-1)) };
      return json(200, { status: 0, data: fake.connections, ticket });
    }
    return { status: 404, headers: {}, body: Buffer.from('<html>Not found</html>') };
  }

  /** The transport of src/llu/http.js, in memory. */
  fake.request = async (rawUrl, options = {}) => {
    const url = new URL(rawUrl);
    const headers = Object.fromEntries(
      Object.entries(options.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]),
    );
    fake.requests.push({
      url: rawUrl,
      host: url.host,
      path: url.pathname,
      method: options.method ?? 'GET',
      headers,
      body: options.body === undefined ? undefined : String(options.body),
    });
    fake.inFlight += 1;
    fake.maxInFlight = Math.max(fake.maxInFlight, fake.inFlight);
    try {
      if (fake.gate) await fake.gate;
      if (fake.unreachable) throw new LibreError(CODES.UNREACHABLE, 'ECONNREFUSED');
      return answer(url, { method: options.method ?? 'GET', body: options.body }, headers);
    } finally {
      fake.inFlight -= 1;
    }
  };

  fake.logins = () => fake.requests.filter((r) => r.path === '/llu/auth/login');
  fake.lists = () => fake.requests.filter((r) => r.path === '/llu/connections');
  fake.glucose = (id, ms, mgdl, trend = 3) => {
    fake.connections.find((c) => c.patientId === id).glucoseMeasurement = measurement(
      ms,
      mgdl,
      trend,
    );
  };

  return fake;
}
