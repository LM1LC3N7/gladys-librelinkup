// -----------------------------------------------------------------------------
// Keys, limits and timings. The manifest keys, the trigger keys and the
// external id shapes are stored in user scenes and devices: never rename them
// (test/manifest.test.js ties them to the manifest).
// -----------------------------------------------------------------------------

export const ACTIONS = Object.freeze({
  TEST: 'test_connection',
});

export const SCENE_TRIGGERS = Object.freeze({
  GLUCOSE_LOW: 'glucose_low',
  GLUCOSE_HIGH: 'glucose_high',
  MEASUREMENT_STALE: 'measurement_stale',
});

/**
 * Device external ids: `ext:<selector>:patient:<patient key>`, the patient
 * key a hexadecimal digest of the LibreLinkUp id of the patient
 * (src/devices.js).
 */
export const DEVICE_TYPE = 'patient';

/**
 * Feature keys. The glucose and the targets carry their unit in their key:
 * the core has no glucose unit, so the unit is in the feature name, and a
 * change of the unit setting never gives an existing feature (and its
 * history) values of another unit.
 */
export const FEATURES = Object.freeze({
  GLUCOSE_MGDL: 'glucose_mgdl',
  GLUCOSE_MMOL: 'glucose_mmol',
  TREND: 'trend',
  AGE: 'measurement_age',
  TARGET_LOW_MGDL: 'target_low_mgdl',
  TARGET_HIGH_MGDL: 'target_high_mgdl',
  TARGET_LOW_MMOL: 'target_low_mmol',
  TARGET_HIGH_MMOL: 'target_high_mmol',
});

/** The glucose unit chosen in the configuration. */
export const UNITS = Object.freeze(['mgdl', 'mmol']);

/** Seconds between two readings (one request each, a login now and then). */
export const POLL_INTERVALS = Object.freeze(['60', '120', '300', '600', '900']);

/**
 * Thresholds of the "glucose low" / "glucose high" triggers, in mg/dL, or
 * `target`: the target range of the account (LibreLinkUp's targetLow /
 * targetHigh), when the API gives it.
 */
export const LOW_THRESHOLDS = Object.freeze(['target', '54', '70', '80']);
export const HIGH_THRESHOLDS = Object.freeze(['target', '180', '250', '300']);
export const TARGET = 'target';

/** Minutes without a new measurement: the choices of the "stale" trigger. */
export const STALE_MINUTES = Object.freeze(['15', '30', '60', '120', '240']);

export const GLUCOSE = Object.freeze({
  /** mg/dL per mmol/L (molar mass of glucose, 180.156 g/mol). */
  MG_PER_MMOL: 18.0156,
  /** A measurement older than this never fires "low" or "high". */
  FRESH_MS: 15 * 60_000,
  /** "Low" is armed again at threshold + this, "high" at threshold - this (mg/dL). */
  HYSTERESIS_MGDL: 5,
  /** Readings outside this range (mg/dL) are not glucose values. */
  MIN_MGDL: 10,
  MAX_MGDL: 1000,
});

/** Caps: what is read, published and fired. */
export const LIMITS = Object.freeze({
  /** Patients followed (LibreLinkUp shares 20 at most). */
  DEVICES: 20,
  /** Scene events sent in one reading. */
  EVENTS_PER_ROUND: 30,
  /** POST /state admits 300 states per minute per integration: stay under 250. */
  STATES_PER_MINUTE: 250,
  /** A patient name published to Gladys is cut to this length. */
  NAME_LENGTH: 100,
});

export const TIMEOUTS = Object.freeze({
  /** One request. */
  API: 30_000,
});

export const INTERVALS = Object.freeze({
  /** A failure (network, unexpected answer) is retried after max(this, the poll interval), doubling. */
  RETRY_MIN_MS: 60_000,
  RETRY_MAX_MS: 60 * 60_000,
  /** HTTP 429 or 5xx: pause of every request, within these bounds (Retry-After if given). */
  BUSY_MIN_MS: 60_000,
  BUSY_MAX_MS: 6 * 3600_000,
  /**
   * The credentials refused, or terms to accept in the app: a stop of 1 h,
   * then 6 h, then 24 h for every refusal after (never a loop: a wrong
   * password tried again and again locks the account).
   */
  REFUSAL_STEPS_MS: Object.freeze([3600_000, 6 * 3600_000, 24 * 3600_000]),
  /** The token is renewed by a login this long before it expires. */
  TOKEN_MARGIN_MS: 3600_000,
});

/** Size cap of an answer read from LibreLinkUp. */
export const MAX_BYTES = 1024 * 1024;

/** The persistent store (refusals, pauses: see src/store.js). */
export const STORE_FILE = 'librelinkup.json';

/**
 * The API of the LibreLinkUp app. The first login goes to the global host;
 * the API may answer with the region of the account, followed only to the
 * official hosts below (a fixed list, as pylibrelinkup's APIUrl): never a
 * host given by an answer.
 */
export const DEFAULT_HOST = 'api.libreview.io';
export const REGIONS = Object.freeze({
  ae: 'api-ae.libreview.io',
  ap: 'api-ap.libreview.io',
  au: 'api-au.libreview.io',
  ca: 'api-ca.libreview.io',
  de: 'api-de.libreview.io',
  eu: 'api-eu.libreview.io',
  eu2: 'api-eu2.libreview.io',
  fr: 'api-fr.libreview.io',
  jp: 'api-jp.libreview.io',
  la: 'api-la.libreview.io',
  ru: 'api.libreview.ru',
  us: 'api-us.libreview.io',
});
export const ALLOWED_HOSTS = Object.freeze([DEFAULT_HOST, ...Object.values(REGIONS)]);

/**
 * Headers of the LibreLinkUp Android app, as pylibrelinkup 0.11.2 sends them.
 * The API refuses an app version it finds too old (TODO.md: to raise when it
 * does).
 */
export const LLU_PRODUCT = 'llu.android';
export const LLU_VERSION = '4.16.0';
