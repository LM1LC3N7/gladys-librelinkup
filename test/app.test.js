// -----------------------------------------------------------------------------
// The integration against the SDK's fake Gladys and the fake LibreLinkUp API,
// through the exact wiring of the container (src/handlers.js).
// -----------------------------------------------------------------------------

import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { LibreApp } from '../src/app.js';
import { ACTIONS, ALLOWED_HOSTS, INTERVALS, SCENE_TRIGGERS } from '../src/constants.js';
import { buildDevice, patientKey } from '../src/devices.js';
import { registerHandlers } from '../src/handlers.js';
import {
  ALICE,
  BOB,
  EMAIL,
  PASSWORD,
  USER_ID,
  connection,
  createFakeLibre,
  measurement,
} from './helpers/fakeLibre.js';
import { createFakeTimers } from './helpers/fakeTimers.js';

const T0 = Date.parse('2026-10-18T08:00:00Z');
const MIN = 60_000;
const HOUR = 3600_000;
const POLL = 120_000;
const SELECTOR = 'librelinkup';
const ids = createFakeGladys({ selector: SELECTOR });
const BASE_CONFIG = { email: EMAIL, password: PASSWORD };
const WRONG = 'not-the-password';
const device = (id, name, options = {}, unit = 'mgdl') =>
  buildDevice(ids, { key: patientKey(id), name, ...options }, unit);
const featureId = (id, feature) => `ext:${SELECTOR}:patient:${patientKey(id)}:${feature}`;
const deviceId = (id) => `ext:${SELECTOR}:patient:${patientKey(id)}`;

let running;
afterEach(async () => {
  await running?.stop();
  running = undefined;
});

async function setup({
  config = {},
  created = [device(ALICE, 'Alice Martin', { hasTargets: true }), device(BOB, 'Bob Durand')],
  libre,
  dataDir,
  now = T0,
  clock = { now, jump: 0 },
} = {}) {
  libre ??= createFakeLibre({ now: () => clock.now });
  const gladys = createFakeGladys({
    selector: SELECTOR,
    config: { ...BASE_CONFIG, ...config },
    devices: created,
  });
  const timers = createFakeTimers();
  const logs = [];
  const logger = Object.fromEntries(
    ['debug', 'info', 'warn', 'error'].map((level) => [
      level,
      (...args) => logs.push(`${level} ${args.map((a) => a?.stack ?? String(a)).join(' ')}`),
    ]),
  );
  dataDir ??= mkdtempSync(join(tmpdir(), 'librelinkup-app-'));
  const app = new LibreApp({
    gladys,
    logger,
    request: libre.request,
    dataDir,
    now: () => clock.now,
    monotonic: () => clock.now - clock.jump,
    timers,
  });
  running = app;
  registerHandlers(gladys, app, logger);
  await gladys.connect();
  return { gladys, libre, timers, clock, logs, app, dataDir };
}

const poll = (timers, ms = POLL) => timers.run((delay) => delay === ms);
const last = (gladys, id, feature) => gladys.fake.lastState(featureId(id, feature));
const storeText = (dataDir) =>
  readdirSync(dataDir)
    .map((file) => {
      // A write in flight renames its temporary file: read what is there.
      try {
        return readFileSync(join(dataDir, file), 'utf8');
      } catch {
        return '';
      }
    })
    .join('\n');
/** Emit `connected` again (Gladys came back) and wait for the restart. */
async function reconnect(gladys, app) {
  gladys.emit('connected');
  for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setImmediate(resolve));
  await app.queue;
}
const events = (gladys) =>
  gladys.fake.sceneEvents.map((e) => [
    e.key,
    e.data.device_name,
    e.data.threshold ?? e.data.minutes,
  ]);

test('start: login with the region, status, Discovery, every value; one request per round', async () => {
  const { gladys, libre, timers } = await setup();
  assert.deepEqual(gladys.fake.connectionStatus, {
    connected: true,
    message: {
      en: 'LibreLinkUp answers: 2 patients, 0 without a measurement for 15 min or more.',
      fr: 'LibreLinkUp répond : 2 patients, 0 sans mesure depuis 15 min ou plus.',
    },
  });
  // The global host, its redirect to the region of the account, the list.
  assert.deepEqual(
    libre.requests.map((r) => [r.method, r.host, r.path]),
    [
      ['POST', 'api.libreview.io', '/llu/auth/login'],
      ['POST', 'api-eu.libreview.io', '/llu/auth/login'],
      ['GET', 'api-eu.libreview.io', '/llu/connections'],
    ],
  );
  const [login, , list] = libre.requests;
  assert.deepEqual(JSON.parse(login.body), { email: EMAIL, password: PASSWORD });
  assert.equal(login.headers.authorization, undefined);
  assert.equal(login.headers.product, 'llu.android');
  assert.equal(login.headers.version, '4.16.0');
  assert.match(login.headers['user-agent'], /^gladys-librelinkup\/\d+\.\d+\.\d+$/);
  assert.equal(list.headers.authorization, 'Bearer token-1');
  assert.equal(list.headers['account-id'], createHash('sha256').update(USER_ID).digest('hex'));
  assert.equal(list.body, undefined);
  assert.deepEqual(
    gladys.fake.discoveredDevices.map((d) => [d.external_id, d.name, d.model]),
    [
      [deviceId(ALICE), 'Alice Martin', 'LibreLinkUp patient'],
      [deviceId(BOB), 'Bob Durand', 'LibreLinkUp patient'],
    ],
  );
  const [alice, bob] = gladys.fake.discoveredDevices;
  assert.ok(alice.features.some((f) => f.external_id.endsWith(':target_low_mgdl')));
  assert.ok(!bob.features.some((f) => f.external_id.includes(':target_')), 'no target given');
  assert.ok(
    alice.features.every((f) => f.keep_history === false),
    'no history by default',
  );
  assert.equal(last(gladys, ALICE, 'glucose_mgdl'), 110);
  assert.equal(last(gladys, ALICE, 'trend'), 3);
  assert.equal(last(gladys, ALICE, 'measurement_age'), 1);
  assert.equal(last(gladys, ALICE, 'target_low_mgdl'), 70);
  assert.equal(last(gladys, ALICE, 'target_high_mgdl'), 180);
  assert.equal(last(gladys, BOB, 'glucose_mgdl'), 150);
  assert.equal(last(gladys, BOB, 'trend'), 4);
  assert.equal(last(gladys, BOB, 'measurement_age'), 2);
  assert.ok(gladys.fake.transports.every((t) => t.transport === 'cloud'));
  assert.equal(gladys.fake.sceneEvents.length, 0);
  assert.deepEqual(timers.delays(), [POLL]);
  // The next rounds: the token is kept, one request each.
  await poll(timers);
  await poll(timers);
  assert.equal(libre.logins().length, 2);
  assert.equal(libre.lists().length, 3);
  assert.deepEqual(timers.delays(), [POLL]);
});

test('mmol/L: features of that unit, values converted, one decimal', async () => {
  const created = [device(ALICE, 'Alice Martin', { hasTargets: true }, 'mmol')];
  const { gladys } = await setup({ config: { glucose_unit: 'mmol' }, created });
  const [alice] = gladys.fake.discoveredDevices;
  const keys = alice.features.map((f) => f.external_id.split(':').at(-1));
  assert.deepEqual(keys, [
    'glucose_mmol',
    'trend',
    'measurement_age',
    'target_low_mmol',
    'target_high_mmol',
  ]);
  assert.match(alice.features[0].name, /\(mmol\/L\)$/);
  assert.equal(last(gladys, ALICE, 'glucose_mmol'), 6.1);
  assert.equal(last(gladys, ALICE, 'target_low_mmol'), 3.9);
  assert.equal(last(gladys, ALICE, 'target_high_mmol'), 10);
});

test('a device published again never loses a feature (unit changed)', async () => {
  const created = [device(ALICE, 'Alice Martin', { hasTargets: true }, 'mmol')];
  const { gladys } = await setup({ created });
  const [alice] = gladys.fake.discoveredDevices;
  const keys = alice.features.map((f) => f.external_id.split(':').at(-1));
  for (const key of ['glucose_mgdl', 'glucose_mmol', 'target_low_mmol', 'target_low_mgdl']) {
    assert.ok(keys.includes(key), key);
  }
  // Every feature the created device has gets its value, in the unit of its key.
  assert.equal(last(gladys, ALICE, 'glucose_mmol'), 6.1, 'the created features keep their values');
  assert.equal(last(gladys, ALICE, 'target_high_mmol'), 10);
  assert.equal(last(gladys, ALICE, 'glucose_mgdl'), undefined, 'not created yet: nothing');
});

test('a device with the features of both units gets both values', async () => {
  const mg = device(ALICE, 'Alice Martin', { hasTargets: true });
  const mmol = device(ALICE, 'Alice Martin', { hasTargets: true }, 'mmol');
  const both = { ...mg, features: [...mg.features, ...mmol.features.slice(0, 1)] };
  const { gladys } = await setup({ created: [both] });
  assert.equal(last(gladys, ALICE, 'glucose_mgdl'), 110);
  assert.equal(last(gladys, ALICE, 'glucose_mmol'), 6.1);
});

test('a measurement missing from an answer: the age goes on, stale may fire, never low/high', async () => {
  const libre = createFakeLibre({ now: () => T0 });
  libre.glucose(ALICE, T0 - MIN, 110);
  const { gladys, timers, clock } = await setup({ libre });
  const alice = libre.connections.find((c) => c.patientId === ALICE);
  clock.now += 2 * MIN;
  alice.glucoseMeasurement = null;
  await poll(timers);
  assert.equal(last(gladys, ALICE, 'measurement_age'), 3, 'from the last measurement accepted');
  assert.equal(last(gladys, ALICE, 'glucose_mgdl'), 110, 'the last value is kept, nothing new');
  clock.now = T0 - MIN + 15 * MIN;
  await poll(timers);
  assert.deepEqual(
    events(gladys).filter((e) => e[1] === 'Alice Martin'),
    [[SCENE_TRIGGERS.MEASUREMENT_STALE, 'Alice Martin', '15']],
  );
  assert.ok(
    !gladys.fake.sceneEvents.some((e) => e.key !== SCENE_TRIGGERS.MEASUREMENT_STALE),
    'never low nor high without a measurement',
  );
});

test('low told again after a gap of 15 min between measurements, or 15 min unseen', async () => {
  const libre = createFakeLibre({ now: () => T0 });
  libre.glucose(ALICE, T0 - MIN, 50);
  const { gladys, timers, clock } = await setup({ libre });
  const lows = () =>
    gladys.fake.sceneEvents.filter((e) => e.key === SCENE_TRIGGERS.GLUCOSE_LOW).length;
  assert.equal(lows(), 4);
  clock.now += 20 * MIN;
  libre.glucose(ALICE, clock.now - MIN, 50);
  await poll(timers);
  assert.equal(lows(), 8, 'a new episode');
  // Alice absent from the list for 16 min, then back with a close measurement.
  const alice = libre.connections.find((c) => c.patientId === ALICE);
  libre.connections = libre.connections.filter((c) => c !== alice);
  clock.now += 16 * MIN;
  await poll(timers);
  libre.connections.push(alice);
  libre.glucose(ALICE, clock.now - MIN, 50);
  clock.now += MIN;
  await poll(timers);
  assert.equal(lows(), 12, 'not seen for 15 min: told again');
});

test('refresh of 15 min, slow requests: one alert for 2 h of continuous low', async () => {
  const clock = { now: T0, jump: 0 };
  const libre = createFakeLibre({ now: () => clock.now });
  libre.glucose(ALICE, T0 - MIN, 50);
  const request = libre.request;
  // Every request takes 20 s: two readings are more than 15 min apart.
  libre.request = async (...args) => {
    clock.now += 20_000;
    return request(...args);
  };
  const { gladys, timers } = await setup({ libre, clock, config: { poll_interval: '900' } });
  const lows70 = () =>
    gladys.fake.sceneEvents.filter(
      (e) => e.key === SCENE_TRIGGERS.GLUCOSE_LOW && e.data.threshold === '70',
    ).length;
  assert.equal(lows70(), 1);
  for (let i = 0; i < 8; i += 1) {
    clock.now += 900_000;
    libre.glucose(ALICE, clock.now - MIN, 50);
    await poll(timers, 900_000);
  }
  assert.equal(libre.lists().length, 9);
  assert.equal(lows70(), 1, 'not told again at every reading');
});

test('a measurement more than a day ahead is dropped but still warns about the clock', async () => {
  const libre = createFakeLibre({ now: () => T0 });
  libre.glucose(ALICE, T0 + 2 * 24 * HOUR, 50);
  const { gladys } = await setup({ libre });
  assert.match(gladys.fake.connectionStatus.message.en, /1 measurement is dated in the future/);
  assert.equal(last(gladys, ALICE, 'glucose_mgdl'), undefined, 'dropped');
});

test('a disconnection between the login and the list: nothing in /data, read again at once', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'librelinkup-app-'));
  const { gladys, libre, timers, app, clock } = await setup({ dataDir });
  app.session.token = null;
  let open;
  libre.gate = new Promise((resolve) => {
    open = resolve;
  });
  const logins = libre.logins().length;
  clock.now += POLL;
  const round = poll(timers);
  for (let i = 0; i < 400 && libre.logins().length === logins; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.equal(libre.logins().length, logins + 1, 'the login left');
  gladys.emit('disconnected');
  libre.gate = null;
  open();
  await round;
  const lists = libre.lists().length;
  assert.equal(lists, 1, 'the list was never asked by the closed client');
  const text = storeText(dataDir);
  assert.ok(!/retryAt|pausedUntil/.test(text), text);
  assert.doesNotMatch(text, /"refusals": \{\s*"/);
  await reconnect(gladys, app);
  assert.equal(libre.lists().length, lists + 1, 'read at once');
  assert.equal(libre.logins().length, logins + 1, 'the token of that login is kept');
  assert.equal(gladys.fake.connectionStatus.connected, true);
});

test('a token of 50 min: one login over several readings', async () => {
  const clock = { now: T0, jump: 0 };
  const libre = createFakeLibre({ now: () => clock.now });
  libre.tokenLifeMs = 50 * MIN;
  const { timers } = await setup({ libre, clock });
  // Half of its life (25 min): renewed once at 26 min, then not again before 51 min.
  for (let i = 0; i < 12; i += 1) {
    clock.now += POLL;
    await poll(timers);
  }
  assert.equal(libre.logins().length, 2, 'global host and region: one login for 24 min');
  clock.now += POLL;
  await poll(timers);
  assert.equal(libre.logins().length, 3, 'renewed at half of its life, in the region');
  for (let i = 0; i < 7; i += 1) {
    clock.now += POLL;
    await poll(timers);
  }
  assert.equal(libre.lists().length, 21);
  assert.equal(libre.logins().length, 3, 'the new token lasts');
});

test('a measurement dated in the future: the status asks to check the clock', async () => {
  const libre = createFakeLibre({ now: () => T0 });
  libre.glucose(ALICE, T0 + HOUR, 50);
  const { gladys } = await setup({ libre });
  assert.match(
    gladys.fake.connectionStatus.message.en,
    /1 measurement is dated in the future: check the clock of Gladys/,
  );
  assert.match(gladys.fake.connectionStatus.message.fr, /vérifiez l’horloge de Gladys/);
  assert.equal(gladys.fake.sceneEvents.length, 0, 'never fresh');
});

test('unknown trend published as 0; events use the name of the created device', async () => {
  const libre = createFakeLibre({ now: () => T0 });
  libre.glucose(ALICE, T0 - MIN, 50, 0);
  const renamed = { ...device(ALICE, 'Alice Martin', { hasTargets: true }), name: 'Maman' };
  const { gladys } = await setup({ libre, created: [renamed] });
  assert.equal(last(gladys, ALICE, 'trend'), 0);
  assert.equal(gladys.fake.sceneEvents[0].data.device_name, 'Maman');
  assert.equal(gladys.fake.sceneEvents[0].data.trend, 0);
});

test('glucose low: a fresh measurement fires once per crossing, armed again 5 mg/dL above', async () => {
  const libre = createFakeLibre({ now: () => T0 });
  libre.glucose(ALICE, T0 - MIN, 65);
  const { gladys, timers, clock } = await setup({ libre });
  // The first reading tells a fresh low (decision: a missing alert is worse).
  assert.deepEqual(events(gladys), [
    [SCENE_TRIGGERS.GLUCOSE_LOW, 'Alice Martin', 'target'],
    [SCENE_TRIGGERS.GLUCOSE_LOW, 'Alice Martin', '70'],
    [SCENE_TRIGGERS.GLUCOSE_LOW, 'Alice Martin', '80'],
  ]);
  const event = gladys.fake.sceneEvents[0];
  assert.equal(event.data.device, deviceId(ALICE));
  assert.equal(event.data.glucose, 65);
  assert.equal(event.data.unit, 'mg/dL');
  assert.equal(event.data.measured_at, '2026-10-18 07:59 UTC');
  // Still low: nothing more.
  clock.now += POLL;
  libre.glucose(ALICE, clock.now - MIN, 60);
  await poll(timers);
  assert.equal(gladys.fake.sceneEvents.length, 3);
  // 72 (< 70 + 5): not armed again for 70; above 80 + 5: everything armed.
  clock.now += POLL;
  libre.glucose(ALICE, clock.now - MIN, 72);
  await poll(timers);
  clock.now += POLL;
  libre.glucose(ALICE, clock.now - MIN, 68);
  await poll(timers);
  assert.equal(gladys.fake.sceneEvents.length, 3, 'within the hysteresis');
  clock.now += POLL;
  libre.glucose(ALICE, clock.now - MIN, 90);
  await poll(timers);
  clock.now += POLL;
  libre.glucose(ALICE, clock.now - MIN, 50);
  await poll(timers);
  assert.equal(gladys.fake.sceneEvents.length, 7, 'target, 54, 70, 80 again');
  assert.equal(gladys.fake.sceneEvents.at(-1).data.glucose, 50);
});

test('glucose low / high: never for an old measurement, nor for a patient not created', async () => {
  const libre = createFakeLibre({ now: () => T0 });
  libre.glucose(ALICE, T0 - 20 * MIN, 50);
  libre.glucose(BOB, T0 - MIN, 300);
  const { gladys, timers, clock } = await setup({
    libre,
    created: [device(ALICE, 'Alice Martin', { hasTargets: true })],
  });
  assert.equal(gladys.fake.sceneEvents.length, 0, '20 min old; Bob not created');
  clock.now += POLL;
  libre.glucose(ALICE, clock.now - MIN, 260);
  await poll(timers);
  assert.deepEqual(events(gladys), [
    [SCENE_TRIGGERS.GLUCOSE_HIGH, 'Alice Martin', 'target'],
    [SCENE_TRIGGERS.GLUCOSE_HIGH, 'Alice Martin', '180'],
    [SCENE_TRIGGERS.GLUCOSE_HIGH, 'Alice Martin', '250'],
  ]);
});

test('the same low measurement read again, or a reconnection, never fires twice', async () => {
  const libre = createFakeLibre({ now: () => T0 });
  libre.glucose(ALICE, T0 - MIN, 50);
  const { gladys, timers, clock, app } = await setup({ libre });
  const sent = gladys.fake.sceneEvents.length;
  assert.equal(sent, 4, 'target, 54, 70, 80');
  clock.now += POLL;
  await poll(timers);
  await reconnect(gladys, app);
  assert.equal(gladys.fake.sceneEvents.length, sent, 'the memory survives a reconnection');
});

test('measurement too old: never at the first reading, once per threshold, re-armed by news', async () => {
  const libre = createFakeLibre({ now: () => T0 });
  libre.glucose(ALICE, T0 - 20 * MIN, 110);
  const { gladys, timers, clock } = await setup({ libre });
  assert.equal(gladys.fake.sceneEvents.length, 0, '15 min already reached at start');
  assert.match(gladys.fake.connectionStatus.message.en, /1 without a measurement/);
  clock.now = T0 - 20 * MIN + 30 * MIN;
  await poll(timers);
  assert.deepEqual(events(gladys), [[SCENE_TRIGGERS.MEASUREMENT_STALE, 'Alice Martin', '30']]);
  assert.equal(gladys.fake.sceneEvents[0].data.stale_for, 30);
  clock.now += 2 * MIN;
  await poll(timers);
  assert.equal(gladys.fake.sceneEvents.length, 1, 'once');
  // A new measurement: the wait is over; 15 min later, it fires again.
  libre.glucose(ALICE, clock.now - MIN, 112);
  await poll(timers);
  assert.equal(last(gladys, ALICE, 'measurement_age'), 1);
  clock.now += 15 * MIN;
  await poll(timers);
  assert.deepEqual(
    events(gladys).filter((e) => e[1] === 'Alice Martin'),
    [
      [SCENE_TRIGGERS.MEASUREMENT_STALE, 'Alice Martin', '30'],
      [SCENE_TRIGGERS.MEASUREMENT_STALE, 'Alice Martin', '15'],
    ],
  );
});

test('no scene event at a reading after a clock jump', async () => {
  const libre = createFakeLibre({ now: () => T0 });
  const { gladys, timers, clock } = await setup({ libre });
  clock.now += 2 * HOUR;
  clock.jump = 2 * HOUR - POLL;
  libre.glucose(ALICE, clock.now - MIN, 40);
  await poll(timers);
  assert.equal(gladys.fake.sceneEvents.length, 0);
  clock.now += POLL;
  libre.glucose(ALICE, clock.now - MIN, 41);
  await poll(timers);
  assert.ok(gladys.fake.sceneEvents.length > 0, 'the next reading tells it');
});

test('refused credentials stop for 1 h, 6 h, 24 h, persisted; one forced attempt per series', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'librelinkup-app-'));
  const { gladys, libre, timers, app } = await setup({ config: { password: WRONG }, dataDir });
  assert.equal(libre.requests.length, 2, 'global host, then the region');
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(gladys.fake.connectionStatus.message.en, /refused the e-mail address/);
  assert.match(gladys.fake.connectionStatus.message.en, /stops for 1 h/);
  assert.match(gladys.fake.connectionStatus.message.fr, /a refusé l’adresse e-mail/);
  assert.deepEqual(timers.delays(), [HOUR]);
  await reconnect(gladys, app);
  assert.match(gladys.fake.connectionStatus.message.en, /refused these credentials earlier/);
  const ack = await gladys.fake.action(ACTIONS.TEST);
  assert.equal(ack.success, false);
  assert.equal(libre.requests.length, 2, 'nothing sent');
  await running.stop();
  const second = await setup({ config: { password: WRONG }, dataDir, libre, now: T0 + 10 * MIN });
  assert.equal(libre.requests.length, 2, 'a restart sends nothing');
  assert.deepEqual(second.timers.delays(), [50 * MIN]);
  second.clock.now = T0 + HOUR;
  await second.timers.run();
  assert.equal(libre.logins().length, 4, 'a new process: the global host again');
  assert.deepEqual(second.timers.delays(), [6 * HOUR]);
  second.clock.now += 6 * HOUR;
  await second.timers.run();
  assert.equal(libre.logins().length, 5, 'the region is known now: one login');
  assert.deepEqual(second.timers.delays(), [24 * HOUR]);
  // Saving the same credentials: one attempt at once, then never again in this series.
  await second.gladys.fake.configUpdated({ ...BASE_CONFIG, password: WRONG });
  assert.equal(libre.logins().length, 6);
  await second.gladys.fake.configUpdated({ ...BASE_CONFIG, password: WRONG });
  assert.equal(libre.logins().length, 6);
  assert.match(second.gladys.fake.connectionStatus.message.en, /Already tried again/);
  // The right password works at once and the stop is forgotten.
  await second.gladys.fake.configUpdated({ ...BASE_CONFIG });
  assert.equal(second.gladys.fake.connectionStatus.connected, true);
  assert.doesNotMatch(storeText(dataDir), /"refusals": \{\s*"/, 'no refusal left');
});

test('a 4xx login with the JSON of the API is a refusal: one password sent, then 1 h, 6 h, 24 h', async () => {
  const libre = createFakeLibre({ now: () => T0 });
  libre.region = null;
  const refused = { status: 400, body: { status: 2, error: { message: 'notAuthenticated' } } };
  libre.failures.push(refused, { ...refused, status: 403 }, { ...refused, status: 401 });
  const { gladys, timers, clock } = await setup({ libre });
  assert.equal(libre.requests.filter((r) => r.body?.includes(PASSWORD)).length, 1);
  assert.match(gladys.fake.connectionStatus.message.en, /refused the e-mail address/);
  assert.deepEqual(timers.delays(), [HOUR]);
  clock.now += HOUR;
  await timers.run();
  assert.deepEqual(timers.delays(), [6 * HOUR]);
  clock.now += 6 * HOUR;
  await timers.run();
  assert.deepEqual(timers.delays(), [24 * HOUR]);
  assert.equal(libre.logins().length, 3);
});

test('a 403 login page without the JSON of the API is not a refusal', async () => {
  const libre = createFakeLibre({ now: () => T0 });
  libre.failures.push({ status: 403, body: '<html>Forbidden</html>' });
  const { gladys, timers } = await setup({ libre });
  assert.match(gladys.fake.connectionStatus.message.en, /HTTP 403/);
  assert.deepEqual(timers.delays(), [POLL]);
});

test('within a series, a login answered 429 moves to the next step (max of step and lockout)', async () => {
  const { gladys, libre, timers, clock } = await setup({ config: { password: WRONG } });
  assert.deepEqual(timers.delays(), [HOUR]);
  libre.failures.push({
    status: 200,
    body: { status: 429, data: { code: 60, data: { failures: 5, lockout: 600 } } },
  });
  clock.now += HOUR;
  await timers.run();
  assert.match(gladys.fake.connectionStatus.message.en, /slow down/);
  assert.deepEqual(timers.delays(), [6 * HOUR], 'step 2, not 1 h again');
  clock.now += 6 * HOUR;
  await timers.run();
  assert.deepEqual(timers.delays(), [24 * HOUR], 'refused again: step 3');
});

test('an attempt in flight when the app stops counts as a refusal', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'librelinkup-app-'));
  const first = await setup({ config: { password: WRONG }, dataDir });
  first.clock.now = T0 + HOUR;
  first.libre.gate = new Promise(() => {});
  const before = first.libre.requests.length;
  void first.timers.run();
  // The request leaves only once the pending attempt is written (renamed) to /data.
  for (let i = 0; i < 400 && first.libre.requests.length === before; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.match(storeText(dataDir), /\\"p\\":true/);
  await running.stop();
  const libre = createFakeLibre({ now: () => T0 + HOUR });
  const second = await setup({ config: { password: WRONG }, dataDir, libre, now: T0 + HOUR });
  assert.equal(libre.requests.length, 0);
  assert.deepEqual(second.timers.delays(), [6 * HOUR], 'one more step');
});

test('terms of use to accept: a stop that invites to accept them in the app, never accepted here', async () => {
  const libre = createFakeLibre({ now: () => T0 });
  libre.step = 'tou';
  const { gladys, timers } = await setup({ libre });
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(
    gladys.fake.connectionStatus.message.en,
    /accept the new terms of use: open the LibreLinkUp app/,
  );
  assert.match(
    gladys.fake.connectionStatus.message.fr,
    /accepter les nouvelles conditions d’utilisation/,
  );
  assert.deepEqual(timers.delays(), [HOUR]);
  assert.ok(
    libre.requests.every((r) => r.path === '/llu/auth/login'),
    'no other endpoint: nothing accepted, no list read with that token',
  );
  // Accepted in the app, the configuration saved: read at once.
  libre.step = null;
  await gladys.fake.configUpdated({ ...BASE_CONFIG });
  assert.equal(gladys.fake.connectionStatus.connected, true);
});

test('privacy policy step: its own words; restart keeps the stop and says why', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'librelinkup-app-'));
  const libre = createFakeLibre({ now: () => T0 });
  libre.step = 'pp';
  const { gladys } = await setup({ libre, dataDir });
  assert.match(gladys.fake.connectionStatus.message.en, /privacy policy/);
  await running.stop();
  const second = await setup({ libre, dataDir, now: T0 + MIN });
  assert.match(second.gladys.fake.connectionStatus.message.en, /accept new terms in its app/);
});

test('a region outside the fixed list is never followed', async () => {
  const libre = createFakeLibre({ now: () => T0 });
  libre.region = 'evil.example.org';
  const { gladys, timers } = await setup({ libre });
  assert.equal(libre.requests.length, 1);
  assert.match(gladys.fake.connectionStatus.message.en, /outside the list of official/);
  assert.deepEqual(timers.delays(), [POLL]);
  for (const r of libre.requests) assert.ok(ALLOWED_HOSTS.includes(r.host), r.host);
});

test('a region named like an inherited property is never followed', async () => {
  for (const region of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
    const libre = createFakeLibre({ now: () => T0 });
    libre.region = region;
    const { gladys } = await setup({ libre });
    assert.equal(libre.requests.length, 1, region);
    assert.match(gladys.fake.connectionStatus.message.en, /outside the list of official/, region);
    await running.stop();
  }
});

test('a 401 to an old token: one login, then a 401 to the fresh token is a refusal', async () => {
  const { gladys, libre, timers } = await setup();
  // The token is revoked: the next round logs in once and reads.
  libre.tokens.push('token-revoked');
  await poll(timers);
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.equal(libre.logins().length, 3);
  assert.equal(libre.lists().length, 3);
  // Two 401 in a row (old, then fresh token): refused, never a loop.
  libre.failures.push(
    { status: 401, path: '/llu/connections' },
    { status: 401, path: '/llu/connections' },
  );
  await poll(timers);
  assert.equal(libre.logins().length, 4);
  assert.equal(libre.lists().length, 5);
  assert.match(gladys.fake.connectionStatus.message.en, /refused the e-mail address/);
  assert.deepEqual(timers.delays(), [HOUR]);
});

test('a token about to expire is renewed by a login; a new ticket of the list is used', async () => {
  const clock = { now: T0, jump: 0 };
  const libre = createFakeLibre({ now: () => clock.now });
  libre.tokenLifeMs = HOUR + 30 * MIN;
  const { libre: api, timers } = await setup({ libre, clock });
  assert.equal(api.logins().length, 2);
  clock.now += 40 * MIN;
  await poll(timers);
  assert.equal(api.logins().length, 2, 'margin: half of a life of 1 h 30');
  clock.now += 6 * MIN;
  await poll(timers);
  assert.equal(api.logins().length, 3, 'within the margin');
  api.rotate = true;
  api.tokenLifeMs = 180 * 24 * HOUR;
  await poll(timers);
  await poll(timers);
  assert.equal(api.lists().at(-1).headers.authorization, `Bearer ${api.tokens.at(-2)}`);
  assert.equal(api.logins().length, 3);
});

test('HTTP 429: a bounded pause of every path, kept across a reconnection and a restart', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'librelinkup-app-'));
  const libre = createFakeLibre({ now: () => T0 });
  libre.failures.push({ status: 429, headers: { 'retry-after': '99999999' } });
  const { gladys, timers, app } = await setup({ libre, dataDir });
  assert.match(gladys.fake.connectionStatus.message.en, /slow down/);
  assert.deepEqual(timers.delays(), [INTERVALS.BUSY_MAX_MS], 'capped at 6 h');
  await reconnect(gladys, app);
  assert.equal(libre.requests.length, 1, 'a reconnection does not read');
  assert.match(gladys.fake.connectionStatus.message.en, /pause goes on/);
  await gladys.fake.configUpdated({ ...BASE_CONFIG });
  assert.equal(libre.requests.length, 1, 'nor a saved configuration');
  await running.stop();
  const second = await setup({ libre, dataDir, now: T0 + HOUR });
  assert.equal(libre.requests.length, 1, 'nor a restart');
  assert.deepEqual(second.timers.delays(), [5 * HOUR]);
  second.clock.now = T0 + 6 * HOUR;
  await second.timers.run();
  assert.equal(second.gladys.fake.connectionStatus.connected, true);
  assert.ok(!storeText(dataDir).includes('pausedUntil'), 'forgotten after a reading that works');
});

test('a login locked for too many attempts (status 429 in the body) pauses for its lockout', async () => {
  const libre = createFakeLibre({ now: () => T0 });
  libre.region = null;
  libre.failures.push({
    status: 200,
    body: { status: 429, data: { code: 60, data: { failures: 5, interval: 60, lockout: 600 } } },
  });
  const { gladys, timers } = await setup({ libre });
  assert.match(gladys.fake.connectionStatus.message.en, /slow down/);
  assert.deepEqual(timers.delays(), [600_000]);
});

test('5xx: paused at least for the interval; other failures retried, doubling', async () => {
  const libre = createFakeLibre({ now: () => T0 });
  libre.failures.push({ status: 503 }, { status: 200, body: '<html>maintenance</html>' });
  const { gladys, timers } = await setup({ libre, config: { poll_interval: '300' } });
  assert.match(gladys.fake.connectionStatus.message.en, /server error \(HTTP 503/);
  assert.deepEqual(timers.delays(), [300_000]);
  await timers.run();
  assert.match(gladys.fake.connectionStatus.message.en, /unexpected way/);
  assert.deepEqual(timers.delays(), [600_000], 'doubling');
  await timers.run();
  assert.equal(gladys.fake.connectionStatus.connected, true);
});

test('the app version refused (status 920): said clearly, retried slowly', async () => {
  const libre = createFakeLibre({ now: () => T0 });
  libre.failures.push({ status: 403, body: { status: 920, data: { minimumVersion: '9.0.0' } } });
  const { gladys, timers } = await setup({ libre });
  assert.match(gladys.fake.connectionStatus.message.en, /refuses the app version.*4\.16\.0/);
  assert.deepEqual(timers.delays(), [POLL]);
});

test('a reconnection to Gladys sends the status and Discovery again, without a new login', async () => {
  const { gladys, libre, app } = await setup();
  const discoveries = gladys.fake.bodies('POST', '/discovered_device').length;
  await reconnect(gladys, app);
  assert.equal(gladys.fake.bodies('POST', '/discovered_device').length, discoveries + 1);
  assert.equal(libre.logins().length, 2, 'the token is kept');
  assert.equal(libre.lists().length, 2);
  assert.equal(gladys.fake.connectionStatus.connected, true);
});

test('other credentials start a new session (new login)', async () => {
  const { gladys, libre } = await setup();
  await gladys.fake.configUpdated({ ...BASE_CONFIG, email: 'Other@example.org' });
  assert.equal(libre.logins().length, 4, 'a new session: the global host again');
  assert.match(gladys.fake.connectionStatus.message.en, /refused/);
});

test('privacy: no health data, name, id, credential nor token in the logs or /data', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'librelinkup-app-'));
  const libre = createFakeLibre({ now: () => T0 });
  libre.glucose(ALICE, T0 - MIN, 61);
  const { gladys, timers, logs, clock } = await setup({ libre, dataDir });
  libre.failures.push({ status: 429 });
  clock.now += POLL;
  await poll(timers);
  await gladys.fake.configUpdated({ ...BASE_CONFIG, password: WRONG });
  const text = `${logs.join('\n')}\n${storeText(dataDir)}`;
  for (const secret of [
    EMAIL,
    PASSWORD,
    WRONG,
    'Alice',
    'Martin',
    'Bob',
    ALICE,
    BOB,
    USER_ID,
    'token-',
    'libreview',
    '/llu/',
    '"61"',
    ': 61',
  ]) {
    assert.ok(!text.includes(secret), `${secret} leaked`);
  }
  assert.ok(!/glucose|mg\/dL|mmol/i.test(storeText(dataDir)), 'no health data in /data');
});

test('read only: a command is refused; the test button tells the patients', async () => {
  const { gladys } = await setup();
  const alice = gladys.fake.discoveredDevices[0];
  const ack = await gladys.fake.setValue(alice, alice.features[0], 1);
  assert.equal(ack.success, false);
  const test = await gladys.fake.action(ACTIONS.TEST);
  assert.equal(test.success, true, test.error);
  assert.match(test.data.message.en, /Connected: 2 patients/);
});

test('an account that follows nobody, a connection without id, a measurement unreadable', async () => {
  const libre = createFakeLibre({ now: () => T0 });
  libre.connections = [];
  const first = await setup({ libre });
  assert.match(first.gladys.fake.connectionStatus.message.en, /follows no patient/);
  await running.stop();
  const other = createFakeLibre({ now: () => T0 });
  other.connections = [
    connection('', 'No', 'Id', measurement(T0 - MIN, 100)),
    connection(ALICE, '', '', {
      ...measurement(T0 - MIN, 100),
      FactoryTimestamp: '13/45/2026 1:00:00 PM',
    }),
  ];
  const { gladys } = await setup({ libre: other });
  assert.deepEqual(
    gladys.fake.discoveredDevices.map((d) => d.name),
    [`LibreLinkUp ${patientKey(ALICE).slice(0, 4)}`],
  );
  assert.equal(last(gladys, ALICE, 'glucose_mgdl'), undefined, 'no date: no value');
  assert.match(gladys.fake.connectionStatus.message.en, /1 patient, 1 without a measurement/);
});

test('missing or invalid credentials: nothing is sent', async () => {
  const libre = createFakeLibre({ now: () => T0 });
  const { gladys } = await setup({ libre, config: { email: '' } });
  assert.match(gladys.fake.connectionStatus.message.en, /Type the e-mail address/);
  await gladys.fake.configUpdated({ ...BASE_CONFIG, email: 'not an address' });
  assert.match(gladys.fake.connectionStatus.message.en, /not valid/);
  await gladys.fake.configUpdated({ ...BASE_CONFIG, password: 'a\u0007b' });
  assert.match(gladys.fake.connectionStatus.message.en, /control character/);
  assert.equal(libre.requests.length, 0);
});
