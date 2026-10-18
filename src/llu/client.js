// -----------------------------------------------------------------------------
// The LibreLinkUp API, as the LibreLinkUp app and pylibrelinkup 0.11.2 (MIT,
// ported to JavaScript: src/pylibrelinkup/pylibrelinkup.py, api_url.py,
// exceptions.py) use it. Read only, two requests:
//   POST /llu/auth/login     e-mail address and password -> a token (Bearer)
//                            and the user id (sent as its SHA-256 digest in
//                            the `account-id` header); or the region of the
//                            account (followed once, to the fixed list of
//                            official hosts only); or a step to complete in
//                            the app (terms of use, privacy policy, e-mail):
//                            never completed here, the reading stops.
//   GET  /llu/connections    the patients shared with the account, each with
//                            its latest measurement and target range
// The token lives in memory only (the `session` the app keeps across a
// reconnection to Gladys), is renewed by a login before it expires, and a
// 401 makes one login only (never a loop). The credentials travel in the
// body of the login only: never in a URL, a log or an error message.
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  ALLOWED_HOSTS,
  DEFAULT_HOST,
  INTERVALS,
  LLU_PRODUCT,
  LLU_VERSION,
  MAX_BYTES,
  REGIONS,
  TIMEOUTS,
} from '../constants.js';
import { CODES, LibreError } from './errors.js';
import { httpRequest } from './http.js';
import {
  parseConnections,
  parseLogin,
  parseTicket,
  readEnvelope,
  readJson,
  stepOf,
} from './parse.js';

/** Seconds of a Retry-After header (delta form only), in ms, or null. */
const retryAfterMs = (value) => {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== 'string' || !/^\s*\d+\s*$/.test(raw)) return null;
  return Number(raw) * 1000;
};

/** gladys-librelinkup/<version>, from package.json (copied into the image). */
export const USER_AGENT = (() => {
  try {
    const { version } = JSON.parse(
      readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
    );
    return typeof version === 'string' ? `gladys-librelinkup/${version}` : 'gladys-librelinkup';
  } catch {
    return 'gladys-librelinkup';
  }
})();

/** A new, empty session: what a login gives (memory only). */
export const newSession = () => ({
  host: null,
  token: null,
  expiresMs: null,
  issuedMs: null,
  accountId: null,
});

export class LibreClient {
  /**
   * @param {object} options
   * @param {string} options.email the e-mail address of the LibreLinkUp account
   * @param {string} options.password its password
   * @param {Function} [options.request] the HTTP transport (tests inject a fake API)
   * @param {object} [options.session] the token and host, kept by the app (memory only)
   * @param {() => number} [options.now] the wall clock (token expiry)
   * @param {(host: string) => string} [options.urlOf] the base URL of a host (loopback tests)
   */
  constructor({
    email,
    password,
    request = httpRequest,
    session = newSession(),
    now = Date.now,
    urlOf = (host) => `https://${host}`,
  }) {
    // The body is built once; the credentials are not kept otherwise.
    this.loginBody = JSON.stringify({ email, password });
    this.request = request;
    this.session = session;
    this.now = now;
    this.urlOf = urlOf;
    this.closed = false;
  }

  close() {
    this.closed = true;
  }

  /** One request to an official host; the API's envelope read on any status. */
  async call(method, host, path, { body, account = false } = {}) {
    if (this.closed) throw new LibreError(CODES.CLOSED, 'Client closed');
    // Never a host outside the fixed list, whatever an answer said.
    if (!ALLOWED_HOSTS.includes(host)) throw new LibreError(CODES.REGION, 'Host not in the list');
    const headers = {
      'content-type': 'application/json',
      'cache-control': 'no-cache',
      product: LLU_PRODUCT,
      version: LLU_VERSION,
      'user-agent': USER_AGENT,
    };
    if (!account || method === 'GET') {
      if (this.session.token) headers.authorization = `Bearer ${this.session.token}`;
      if (this.session.accountId) headers['account-id'] = this.session.accountId;
    }
    const response = await this.request(`${this.urlOf(host)}${path}`, {
      method,
      headers,
      body,
      timeout: TIMEOUTS.API,
      maxBytes: MAX_BYTES,
    });
    const envelope = readEnvelope(response.body ?? Buffer.alloc(0));
    // A step to complete in the app, on any answer: never completed here.
    const step = stepOf(envelope);
    if (step) throw new LibreError(CODES.TERMS, `Step required: ${step}`, { step });
    if (envelope?.status === 920) {
      throw new LibreError(CODES.VERSION, 'App version refused', { status: response.status });
    }
    const loose = readJson(response.body ?? Buffer.alloc(0));
    if (
      account &&
      method === 'POST' &&
      response.status >= 400 &&
      response.status <= 499 &&
      response.status !== 429 &&
      loose !== null &&
      (loose.status === 2 || (loose.error && typeof loose.error === 'object'))
    ) {
      // The login refused by the API itself (its own JSON, any 4xx): a
      // refusal. A 4xx page without it (a proxy, a CDN) stays a failure.
      throw new LibreError(CODES.REFUSED, 'Credentials refused', {
        status: response.status,
        account: true,
      });
    }
    if (response.status < 200 || response.status > 299) {
      const lockout = envelope?.data?.data?.lockout;
      throw new LibreError(CODES.HTTP, `HTTP ${response.status}`, {
        status: response.status,
        retryAfterMs:
          retryAfterMs(response.headers?.['retry-after']) ??
          (Number.isFinite(lockout) && lockout > 0 ? lockout * 1000 : null),
        envelope: envelope !== null,
        account,
      });
    }
    if (envelope === null) throw new LibreError(CODES.BAD_ANSWER, 'Not the JSON of the API');
    return envelope;
  }

  /** Log in (the region of the account followed once). Rejects a LibreError. */
  async login() {
    const session = this.session;
    session.token = null;
    session.accountId = null;
    let host = session.host ?? DEFAULT_HOST;
    for (let hop = 0; hop < 2; hop += 1) {
      const value = await this.call('POST', host, '/llu/auth/login', {
        body: this.loginBody,
        account: true,
      });
      const login = parseLogin(value);
      switch (login?.kind) {
        case 'ok':
          session.host = host;
          session.token = login.token;
          session.expiresMs = login.expiresMs;
          session.issuedMs = this.now();
          session.accountId = createHash('sha256').update(login.userId).digest('hex');
          return;
        case 'redirect': {
          // Own keys only: never `constructor`, `__proto__` or another
          // inherited name.
          const region = login.region.toLowerCase();
          const next = Object.hasOwn(REGIONS, region) ? REGIONS[region] : null;
          if (typeof next !== 'string')
            throw new LibreError(CODES.REGION, 'Region not in the list');
          // One hop, to another host: never a loop.
          if (hop > 0 || next === host) throw new LibreError(CODES.BAD_ANSWER, 'Redirect loop');
          host = next;
          // The region of the account is known: the next logins go there.
          session.host = next;
          continue;
        }
        case 'locked':
          throw new LibreError(CODES.HTTP, 'HTTP 429 (login locked)', {
            status: 429,
            retryAfterMs: login.retryAfterMs,
            envelope: true,
            account: true,
          });
        case 'version':
          throw new LibreError(CODES.VERSION, 'App version refused');
        case 'refused':
          throw new LibreError(CODES.REFUSED, 'Credentials refused', { account: true });
        default:
          throw new LibreError(CODES.BAD_ANSWER, 'Not a login answer');
      }
    }
    throw new LibreError(CODES.BAD_ANSWER, 'Redirect loop');
  }

  /** Is the token missing, or about to expire? */
  needsLogin() {
    const { token, expiresMs, issuedMs } = this.session;
    if (!token || !this.session.host) return true;
    if (expiresMs === null) return false;
    // 1 h before the end, or half of its life for a short token.
    const life = issuedMs === null ? Infinity : Math.max(0, expiresMs - issuedMs);
    const margin = Math.min(INTERVALS.TOKEN_MARGIN_MS, life / 2);
    return this.now() >= expiresMs - margin;
  }

  /**
   * The patients shared with the account. Logs in when needed; a 401 to an
   * older token makes one login and one more try (a 401 to a fresh token is
   * a refusal). Rejects a LibreError.
   */
  async connections() {
    let fresh = false;
    if (this.needsLogin()) {
      await this.login();
      fresh = true;
    }
    let value;
    try {
      value = await this.call('GET', this.session.host, '/llu/connections', { account: fresh });
    } catch (err) {
      if (fresh || err?.code !== CODES.HTTP || err.status !== 401) throw err;
      await this.login();
      value = await this.call('GET', this.session.host, '/llu/connections', { account: true });
    }
    const ticket = parseTicket(value);
    if (ticket) {
      if (ticket.token !== this.session.token || ticket.expiresMs !== this.session.expiresMs) {
        this.session.issuedMs = this.now();
      }
      this.session.token = ticket.token;
      if (ticket.expiresMs !== null) this.session.expiresMs = ticket.expiresMs;
    }
    const patients = parseConnections(value);
    if (!patients) throw new LibreError(CODES.BAD_ANSWER, 'Not the list of connections');
    return patients;
  }
}
