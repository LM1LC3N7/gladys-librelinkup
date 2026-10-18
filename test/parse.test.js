// -----------------------------------------------------------------------------
// The answers of the API, read (src/llu/parse.js). Shapes of pylibrelinkup
// 0.11.2 (models/), values made up.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cut } from '../src/devices.js';
import {
  cleanName,
  formatDate,
  parseConnections,
  parseFactoryTimestamp,
  parseLogin,
  parseMeasurement,
  stepOf,
  toMmol,
} from '../src/llu/parse.js';
import { ALICE, connection, factory, measurement } from './helpers/fakeLibre.js';

test('FactoryTimestamp: 12-hour clock in UTC, impossible dates refused', () => {
  assert.equal(parseFactoryTimestamp('10/18/2026 7:58:00 AM'), Date.parse('2026-10-18T07:58:00Z'));
  assert.equal(parseFactoryTimestamp('10/18/2026 12:05:09 AM'), Date.parse('2026-10-18T00:05:09Z'));
  assert.equal(parseFactoryTimestamp('10/18/2026 12:05:09 PM'), Date.parse('2026-10-18T12:05:09Z'));
  assert.equal(parseFactoryTimestamp('1/2/2027 11:59:59 PM'), Date.parse('2027-01-02T23:59:59Z'));
  for (const bad of [
    '02/30/2026 1:00:00 PM',
    '13/01/2026 1:00:00 PM',
    '10/18/2026 13:00:00 PM',
    '10/18/2026 0:00:00 AM',
    '10/18/1999 1:00:00 PM',
    '2026-10-18T07:58:00Z',
    '',
    null,
    42,
  ]) {
    assert.equal(parseFactoryTimestamp(bad), null, String(bad));
  }
  const ms = Date.parse('2026-10-18T15:04:05Z');
  assert.equal(parseFactoryTimestamp(factory(ms)), ms, 'the helper of the tests agrees');
  assert.equal(formatDate(ms), '2026-10-18 15:04 UTC');
});

test('the login answers: ok, redirect, step, locked, version, refused', () => {
  assert.deepEqual(
    parseLogin({
      status: 0,
      data: { user: { id: 'u' }, authTicket: { token: 't', expires: 1792310400 } },
    }),
    { kind: 'ok', token: 't', expiresMs: 1792310400_000, userId: 'u' },
  );
  assert.deepEqual(parseLogin({ status: 0, data: { redirect: true, region: 'eu2' } }), {
    kind: 'redirect',
    region: 'eu2',
  });
  assert.deepEqual(parseLogin({ status: 4, data: { step: { type: 'tou' }, authTicket: {} } }), {
    kind: 'step',
    step: 'tou',
  });
  assert.deepEqual(
    parseLogin({ status: 429, data: { code: 60, data: { failures: 5, lockout: 300 } } }),
    { kind: 'locked', retryAfterMs: 300_000 },
  );
  assert.deepEqual(parseLogin({ status: 920, data: { minimumVersion: '5.0.0' } }), {
    kind: 'version',
  });
  assert.deepEqual(parseLogin({ status: 2, error: { message: 'notAuthenticated' } }), {
    kind: 'refused',
  });
  assert.equal(parseLogin({ status: 0, data: {} }), null);
  assert.equal(parseLogin([]), null);
  assert.equal(stepOf({ data: { step: { type: 'x y' } } }), null, 'not a step name');
});

test('a measurement: plausible values only, trend 1 to 5', () => {
  const ms = Date.parse('2026-10-18T07:58:00Z');
  assert.deepEqual(parseMeasurement(measurement(ms, 104, 5)), {
    mgdl: 104,
    timestampMs: ms,
    trend: 5,
  });
  assert.equal(parseMeasurement(measurement(ms, 104, 0)).trend, null);
  assert.equal(parseMeasurement(measurement(ms, 5)), null, 'not a glucose value');
  assert.equal(parseMeasurement(measurement(ms, '104')), null);
  assert.equal(parseMeasurement(null), null);
  assert.equal(toMmol(104), 5.8);
  assert.equal(toMmol(54), 3);
});

test('names: controls, bidi and zero-width characters removed; cut on a whole character', () => {
  const c = String.fromCharCode;
  const name = `Al${c(0x85)}ice${c(0x202e)} ${c(0x200b)}Mar${c(0x2066)}tin${c(0xfeff)}`;
  assert.equal(cleanName(name), 'Al ice Martin');
  assert.equal(cleanName('  a \t\n b '), 'a b');
  assert.equal(cleanName(42), '');
  assert.equal(cut('ab😀', 3), 'ab', 'never half of a surrogate pair');
  assert.equal(cut('ab😀', 4), 'ab😀');
  assert.equal(cut('abc', 2), 'ab');
});

test('the connections: id, name, measurement, a coherent target range', () => {
  const ms = Date.parse('2026-10-18T07:58:00Z');
  const list = parseConnections({
    status: 0,
    data: [
      connection(ALICE, ' Alice\n', 'Martin', measurement(ms, 99)),
      connection(ALICE, 'Twice', '', measurement(ms, 99)),
      connection('../x', 'Bad', 'Id', null),
      connection('p-2', '', '', null, { targetLow: 180, targetHigh: 70 }),
      'nothing',
    ],
  });
  assert.deepEqual(list, [
    {
      patientId: ALICE,
      name: 'Alice Martin',
      measurement: { mgdl: 99, timestampMs: ms, trend: 3 },
      targetLowMgdl: 70,
      targetHighMgdl: 180,
    },
    { patientId: 'p-2', name: null, measurement: null, targetLowMgdl: null, targetHighMgdl: null },
  ]);
  assert.equal(parseConnections({ status: 0, data: {} }), null);
  assert.equal(parseConnections({ status: 4, data: [] }), null);
});
