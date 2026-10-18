// -----------------------------------------------------------------------------
// The configuration the user fills (manifest `config_schema`), normalized.
// -----------------------------------------------------------------------------

import { POLL_INTERVALS, UNITS } from './constants.js';

// Defaults: they MUST match the `default` values of the manifest.
export const DEFAULTS = Object.freeze({
  poll_interval: '120',
  glucose_unit: 'mgdl',
});

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/;

export function normalizeConfig(raw = {}) {
  raw = raw ?? {};
  const pick = (key, list) => (list.includes(String(raw[key])) ? String(raw[key]) : DEFAULTS[key]);
  const email = typeof raw.email === 'string' ? raw.email.trim() : '';
  // A password pasted with its line end: the line end is not part of it.
  const password = typeof raw.password === 'string' ? raw.password.replace(/[\r\n]+$/, '') : '';
  return {
    email,
    password,
    emailInvalid:
      email !== '' &&
      (CONTROL.test(email) || email.length > 254 || !/^[^@\s]+@[^@\s]+$/.test(email)),
    passwordInvalid: password !== '' && (CONTROL.test(password) || password.length > 512),
    pollSeconds: Number(pick('poll_interval', POLL_INTERVALS)),
    unit: pick('glucose_unit', UNITS),
  };
}
