// -----------------------------------------------------------------------------
// The transport (src/llu/http.js) and the client against loopback http
// servers: deadline, size cap, no redirect, POST body, no URL in an error,
// only the hosts of the fixed list.
// -----------------------------------------------------------------------------

import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { LibreClient, newSession } from '../src/llu/client.js';
import { CODES, LibreError, isRefused, isStop } from '../src/llu/errors.js';
import { httpRequest } from '../src/llu/http.js';

let server;
let base;
const seen = [];

before(async () => {
  server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      seen.push({
        url: req.url,
        method: req.method,
        headers: req.headers,
        body: Buffer.concat(chunks).toString(),
      });
      const json = (status, value, headers = {}) => {
        res.writeHead(status, { 'content-type': 'application/json', ...headers });
        res.end(JSON.stringify(value));
      };
      if (req.url === '/slow') return; // never answers
      if (req.url === '/big') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(Buffer.alloc(4096, 0x20));
        return;
      }
      if (req.url === '/redirect') {
        res.writeHead(302, { location: 'https://elsewhere.example.org/' });
        res.end();
        return;
      }
      if (req.url === '/llu/auth/login') {
        json(200, {
          status: 0,
          data: { user: { id: 'u-1' }, authTicket: { token: 'tok', expires: 4102444000 } },
        });
        return;
      }
      if (req.url === '/llu/connections') {
        json(429, { message: 'slow down' }, { 'retry-after': '120' });
        return;
      }
      res.writeHead(403, { 'content-type': 'text/html' });
      res.end('<html>Forbidden</html>');
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
});

const loopback = (url, options) => httpRequest(url, { ...options, allowHttp: true });

test('plain http is refused unless the loopback tests allow it', async () => {
  await assert.rejects(httpRequest(`${base}/x`, { timeout: 1000, maxBytes: 100 }), (err) => {
    assert.equal(err.code, CODES.BAD_ANSWER);
    assert.ok(!err.message.includes('127.0.0.1'));
    return true;
  });
});

test('a deadline, a size cap, no redirect followed; no URL in the errors', async () => {
  await assert.rejects(loopback(`${base}/slow`, { timeout: 200, maxBytes: 100 }), (err) => {
    assert.equal(err.code, CODES.TIMEOUT);
    assert.ok(!err.message.includes('slow'));
    return true;
  });
  await assert.rejects(loopback(`${base}/big`, { timeout: 2000, maxBytes: 1000 }), {
    code: CODES.TOO_LARGE,
  });
  const redirect = await loopback(`${base}/redirect`, { timeout: 2000, maxBytes: 1000 });
  assert.equal(redirect.status, 302, 'given back, not followed');
  await assert.rejects(
    loopback('http://127.0.0.1:1/x', { timeout: 2000, maxBytes: 100 }),
    (err) => err instanceof LibreError && err.code === CODES.UNREACHABLE,
  );
});

test('the client: POST body with its length, Bearer and account-id, Retry-After', async () => {
  const session = newSession();
  const client = new LibreClient({
    email: 'user@example.org',
    password: 'pässword',
    request: loopback,
    session,
    urlOf: () => base,
  });
  await assert.rejects(client.connections(), (err) => {
    assert.equal(err.status, 429);
    assert.equal(err.retryAfterMs, 120_000);
    assert.equal(isRefused(err), false);
    return true;
  });
  const login = seen.find((r) => r.url === '/llu/auth/login');
  assert.equal(login.method, 'POST');
  assert.deepEqual(JSON.parse(login.body), { email: 'user@example.org', password: 'pässword' });
  assert.equal(Number(login.headers['content-length']), Buffer.byteLength(login.body));
  assert.equal(login.headers.authorization, undefined);
  const list = seen.find((r) => r.url === '/llu/connections');
  assert.equal(list.method, 'GET');
  assert.equal(list.headers.authorization, 'Bearer tok');
  assert.match(list.headers['account-id'], /^[0-9a-f]{64}$/);
  assert.equal(session.token, 'tok', 'kept in memory for the next reading');
  client.close();
  await assert.rejects(client.connections(), { code: CODES.CLOSED });
});

test('never a host outside the list, whatever the session says', async () => {
  const session = { ...newSession(), host: 'evil.example.org', token: 't' };
  const seenUrls = [];
  const client = new LibreClient({
    email: 'a@b.c',
    password: 'p',
    session,
    request: async (url) => {
      seenUrls.push(url);
      return { status: 200, headers: {}, body: Buffer.from('{}') };
    },
  });
  await assert.rejects(client.connections(), { code: CODES.REGION });
  assert.deepEqual(seenUrls, []);
});

test('what a refusal and a stop are', () => {
  const login401 = new LibreError(CODES.HTTP, 'HTTP 401', { status: 401, account: true });
  assert.equal(isRefused(login401), true);
  const old401 = new LibreError(CODES.HTTP, 'HTTP 401', { status: 401, account: false });
  assert.equal(isRefused(old401), false, 'an old token: one login again');
  assert.equal(isRefused(new LibreError(CODES.REFUSED, 'x')), true);
  assert.equal(isStop(new LibreError(CODES.TERMS, 'x', { step: 'tou' })), true);
  assert.equal(isStop(new LibreError(CODES.HTTP, 'HTTP 403', { status: 403 })), false);
});
