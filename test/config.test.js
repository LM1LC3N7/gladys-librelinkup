// -----------------------------------------------------------------------------
// The configuration, normalized.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS, normalizeConfig } from '../src/config.js';

test('defaults and choices outside the list', () => {
  const config = normalizeConfig();
  assert.equal(config.pollSeconds, Number(DEFAULTS.poll_interval));
  assert.equal(config.unit, DEFAULTS.glucose_unit);
  assert.equal(config.email, '');
  assert.equal(normalizeConfig({ poll_interval: '10' }).pollSeconds, 120, 'never under 1 min');
  assert.equal(normalizeConfig({ poll_interval: 300 }).pollSeconds, 300);
  assert.equal(normalizeConfig({ glucose_unit: 'mmol' }).unit, 'mmol');
  assert.equal(normalizeConfig({ glucose_unit: 'mg' }).unit, 'mgdl');
  assert.equal(normalizeConfig(null).pollSeconds, 120);
});

test('credentials: trimmed address, password kept but its line end, invalid ones said', () => {
  const config = normalizeConfig({ email: ' me@example.org ', password: ' pass word \n' });
  assert.equal(config.email, 'me@example.org');
  assert.equal(config.password, ' pass word ');
  assert.equal(config.emailInvalid, false);
  assert.equal(config.passwordInvalid, false);
  assert.equal(normalizeConfig({ email: 'me example.org' }).emailInvalid, true);
  assert.equal(normalizeConfig({ email: 'a\nb@c' }).emailInvalid, true);
  assert.equal(normalizeConfig({ password: 'a\tb' }).passwordInvalid, true);
  assert.equal(normalizeConfig({ password: 42 }).password, '');
});
