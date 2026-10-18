// -----------------------------------------------------------------------------
// Answers of the LibreLinkUp API -> plain objects, as pylibrelinkup 0.11.2
// reads them (models/login.py, models/connection.py, models/data.py). Only
// what the integration publishes is kept: the patient id (digested at once
// by the app), the name for Gladys, the latest measurement and the target
// range. Nothing here is ever logged.
// -----------------------------------------------------------------------------

import { GLUCOSE } from '../constants.js';

const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const finite = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : null);
/** Epoch seconds -> ms, null when absent or implausible (before 2000, after 2100). */
const epochMs = (seconds) => {
  const ms = finite(seconds) === null ? null : seconds * 1000;
  return ms !== null && ms >= Date.UTC(2000, 0, 1) && ms < Date.UTC(2100, 0, 1) ? ms : null;
};

/**
 * `FactoryTimestamp` ("10/18/2026 7:58:00 AM", the clock of the sensor in
 * UTC, as pylibrelinkup reads it) -> ms, or null. `Timestamp` (the local time
 * of the phone, without its zone) is never used.
 */
export function parseFactoryTimestamp(value) {
  if (typeof value !== 'string') return null;
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4}) (\d{1,2}):(\d{2}):(\d{2}) ([AP]M)$/.exec(value.trim());
  if (!m) return null;
  const [month, day, year, hour12, minute, second] = m.slice(1, 7).map(Number);
  if (hour12 < 1 || hour12 > 12 || year < 2000 || year >= 2100) return null;
  const hour = (hour12 % 12) + (m[7] === 'PM' ? 12 : 0);
  const ms = Date.UTC(year, month - 1, day, hour, minute, second);
  const d = new Date(ms);
  // An impossible date (02/30, 13/01, 61 s) does not round-trip.
  if (
    d.getUTCFullYear() !== year ||
    d.getUTCMonth() !== month - 1 ||
    d.getUTCDate() !== day ||
    d.getUTCMinutes() !== minute ||
    d.getUTCSeconds() !== second
  ) {
    return null;
  }
  return ms;
}

/** A date for people: `2026-10-18 07:58 UTC` (the zone of Gladys is unknown). */
export function formatDate(ms) {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return null;
  const iso = new Date(ms).toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}

/** A glucose value in mg/dL within the plausible range, else null. */
export const plausibleMgdl = (value) => {
  const v = finite(value);
  return v !== null && v >= GLUCOSE.MIN_MGDL && v <= GLUCOSE.MAX_MGDL ? v : null;
};

/** mg/dL -> mmol/L, one decimal (as the app shows it; may differ by 0.1). */
export const toMmol = (mgdl) =>
  mgdl === null ? null : Math.round((mgdl / GLUCOSE.MG_PER_MMOL) * 10) / 10;

/** The API's own JSON envelope: an object with a numeric `status`. */
export function readEnvelope(body) {
  try {
    const value = JSON.parse(Buffer.isBuffer(body) ? body.toString('utf8') : String(body));
    return isObject(value) && typeof value.status === 'number' ? value : null;
  } catch {
    return null;
  }
}

/** The step the API asks before anything else (`tou`, `pp`, `verifyEmail`...), or null. */
export function stepOf(envelope) {
  const type = envelope?.data?.step?.type;
  return typeof type === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(type) ? type : null;
}

/**
 * The answer of POST /llu/auth/login:
 *   { kind: 'ok', token, expiresMs, userId }
 *   { kind: 'redirect', region }        the account lives in another region
 *   { kind: 'step', step }              terms / policy / e-mail to accept or verify
 *   { kind: 'locked', retryAfterMs }    too many attempts (status 429 in the body)
 *   { kind: 'version' }                 the app version sent is too old (status 920)
 *   { kind: 'refused' }                 wrong credentials (status 2)
 *   null                                anything else
 */
export function parseLogin(value) {
  if (!isObject(value)) return null;
  const data = isObject(value.data) ? value.data : {};
  // The order of pylibrelinkup: a redirect first, then a step.
  if (data.redirect === true) {
    return { kind: 'redirect', region: typeof data.region === 'string' ? data.region : '' };
  }
  const step = stepOf(value);
  if (step) return { kind: 'step', step };
  if (value.status === 429) {
    const lockout = finite(data.data?.lockout);
    return {
      kind: 'locked',
      retryAfterMs: lockout !== null && lockout > 0 ? lockout * 1000 : null,
    };
  }
  if (value.status === 920) return { kind: 'version' };
  const token = data.authTicket?.token;
  const userId = data.user?.id;
  if (
    value.status === 0 &&
    typeof token === 'string' &&
    token.length > 0 &&
    token.length <= 8192 &&
    typeof userId === 'string' &&
    userId.length > 0 &&
    userId.length <= 200
  ) {
    return { kind: 'ok', token, expiresMs: epochMs(data.authTicket.expires), userId };
  }
  if (value.status === 2 || isObject(value.error)) return { kind: 'refused' };
  return null;
}

/** A new ticket given with an answer: { token, expiresMs } or null. */
export function parseTicket(value) {
  const ticket = value?.ticket;
  if (!isObject(ticket) || typeof ticket.token !== 'string' || !ticket.token) return null;
  if (ticket.token.length > 8192) return null;
  return { token: ticket.token, expiresMs: epochMs(ticket.expires) };
}

/** The latest measurement of a connection, or null. */
export function parseMeasurement(value) {
  if (!isObject(value)) return null;
  const mgdl = plausibleMgdl(value.ValueInMgPerDl);
  const timestampMs = parseFactoryTimestamp(value.FactoryTimestamp);
  if (mgdl === null || timestampMs === null) return null;
  const trend = finite(value.TrendArrow);
  return {
    mgdl,
    timestampMs,
    trend: trend !== null && Number.isInteger(trend) && trend >= 1 && trend <= 5 ? trend : null,
  };
}

const PATIENT_ID = /^[0-9A-Za-z-]{1,64}$/;
const cleanName = (value) =>
  typeof value === 'string'
    ? value
        // eslint-disable-next-line no-control-regex
        .replace(/[\u0000-\u001f\u007f]/g, ' ')
        .trim()
    : '';

/**
 * GET /llu/connections -> [{ patientId, name, measurement, targetLowMgdl,
 * targetHighMgdl }], or null when it is not the list. A connection without a
 * readable patient id is skipped alone.
 */
export function parseConnections(value) {
  if (!isObject(value) || value.status !== 0 || !Array.isArray(value.data)) return null;
  const patients = [];
  const seen = new Set();
  for (const connection of value.data) {
    if (!isObject(connection)) continue;
    const patientId = connection.patientId;
    if (typeof patientId !== 'string' || !PATIENT_ID.test(patientId) || seen.has(patientId)) {
      continue;
    }
    seen.add(patientId);
    const name = [cleanName(connection.firstName), cleanName(connection.lastName)]
      .filter(Boolean)
      .join(' ');
    const low = plausibleMgdl(connection.targetLow);
    const high = plausibleMgdl(connection.targetHigh);
    const range = low !== null && high !== null && low < high;
    patients.push({
      patientId,
      name: name || null,
      measurement: parseMeasurement(connection.glucoseMeasurement),
      targetLowMgdl: range ? low : null,
      targetHighMgdl: range ? high : null,
    });
  }
  return patients;
}
