# TODO — LibreLinkUp v1

Handoff document: what is done, what was decided, what comes next. Keep it
up to date at the end of every milestone.

## Working method

- One milestone at a time, one commit per milestone, tests green before moving on.
- After each milestone: `npm run format:check`, `npm run lint`, `npm test`
  (Node 22 and 24), `npm audit --omit=dev`,
  `npx github:GladysAssistant/integration-store .`, then update README,
  `docs/en.md`, `docs/fr.md`, `CHANGELOG.md` and this file.
- The `gladys-assistant-integration` topic is added at the first real release
  only. No forum topic of its own (Louis's rule: one message per wave in
  /t/10385). Lot 7, wave 2 (reserved in post 262 of the thread).

## Status

- [x] **Milestone 1 — MVP** (2026-10-18): pylibrelinkup 0.11.2 ported to
      JavaScript (login with the region of the account, list of
      connections); one device per patient (glucose in the unit of the
      configuration, trend, measurement age, targets when given), read only,
      no history by default; triggers `glucose_low`, `glucose_high`,
      `measurement_stale`; stop ladder 1 h / 6 h / 24 h persisted (refused
      credentials, terms to accept: never accepted); 429 / locked login /
      5xx pause bounded and persisted; status and Discovery sent again at
      every `connected`, token kept; never a smaller device; 250 states/min
      budget; no health data, name, id, credential or token in logs or
      `/data`; docs en/fr with the medical warning in bold. Tested with unit
      tests against the SDK's fake Gladys, a fake LibreLinkUp API (shapes of
      pylibrelinkup's models) and loopback http servers.
      **Never tested with a real account.** No Docker on this PC: no e2e
      test in a container.
- [ ] **Milestone 2 — real account** (a tester with a LibreLinkUp account
      following a sensor): record real answers as fixtures (names, ids,
      values, tokens removed), fix what differs. To check first:
  - whether `version: 4.16.0` is still accepted (status 920 otherwise:
    raise `LLU_VERSION` in `src/constants.js`, then the test helper);
  - the first host: does `api.libreview.io` answer the login with the
    redirect to the region (as the app does), or must the region be asked
    in the configuration?
  - how a wrong password is answered (HTTP 200 `status: 2`, as assumed, or
    HTTP 401?) and after how many attempts the account is locked (the
    `status: 429` body with `lockout` in seconds is assumed);
  - the unit of `targetLow` / `targetHigh` (read as mg/dL whatever the unit
    of the account: to confirm with an account in mmol/L), and whether
    `alarmRules` (`h.th`, `l.th`) would be the better thresholds;
  - the token lifetime (`authTicket.expires`) and whether the list rotates
    the ticket;
  - how the API answers a list when new terms appear after the login (a
    `data.step` in the error body is assumed, any status);
  - whether `accept-encoding: gzip` is required (not sent: the answer is
    read uncompressed) and whether an honest user agent is accepted.
- [ ] **Later, if users ask** (not now): the graph of the last 12 hours
      (published with their real dates would need the core), several
      accounts, an "out of range" binary, the target in the trigger fields
      per patient.
- [ ] **Milestone 3 — first release**: Docker image build check, Release
      workflow, topic, GHCR package public (the main session publishes),
      then the store validator once the image is published.

## Decisions

- **Duplicate check**: done by the main session before the brief (lot 7,
  post 262); not repeated here.
- **Reuse**: pylibrelinkup 0.11.2 (MIT, Python, read at tag `v0.11.2`,
  commit `a21d307`) cannot run in this Node image: its client is ported to
  JavaScript (`src/llu/`), the MIT notice in `THIRD_PARTY_NOTICES.md`,
  copied into the image. Structure and protections from
  LM1LC3N7/gladys-invoxia (same author, Apache-2.0). The standard
  Apache-2.0 `LICENSE` (no personal name).
- **Version**: 0.1.0 set by hand in `package.json`, `package-lock.json`, the
  manifest and the `docker_image` tag
  (`ghcr.io/lm1lc3n7/gladys-librelinkup:0.1.0`); the first patch release
  gives 0.1.1.
- **Not a medical device**: the docs say it in bold (en/fr), the manifest
  intro starts with it, the trigger descriptions say "may be late or
  missing, never a medical alarm". The docs say that nothing is told when
  LibreLinkUp itself cannot be read.
- **App version sent** (`LLU_VERSION` in `src/constants.js`): the constant
  `4.16.0`, with `product: llu.android`, the headers of pylibrelinkup
  0.11.2. The API refuses versions it finds too old (`status: 920`): the
  status then asks to update the integration; raising it is a code change
  (and the test helper checks it).
- **Endpoints** (pylibrelinkup's `pylibrelinkup.py`): `POST
/llu/auth/login` (`{ email, password }`) and `GET /llu/connections`
  (Bearer token, `account-id` = SHA-256 hex of the user id). The list gives
  the latest measurement (`glucoseMeasurement`) and the target range of
  every patient: one request per reading. `graph` and `logbook` are not
  read (history: not needed). No other route, no command.
- **Region**: the first login goes to `api.libreview.io`; a `redirect` answer
  with a `region` is followed once, only when the region is a key of the
  fixed list (`REGIONS`, the hosts of pylibrelinkup's `APIUrl`: ae, ap, au,
  ca, de, eu, eu2, fr, jp, la, ru, us); any other region is an error, no
  request goes there; the client also refuses any host outside
  `ALLOWED_HOSTS`. The region learned stays in memory for the session
  (never in `/data`). No region setting: the API knows the account.
- **Terms of use / privacy policy / e-mail**: a `data.step` in any answer
  (`tou`, `pp`, `verifyEmail`...) stops the reading; the token of that
  answer is never used and the "accept" endpoints are never called. The
  status asks to accept in the LibreLinkUp app, then to save the
  configuration. It takes the stop ladder (1 h, 6 h, 24 h, one forced
  attempt per series), stored with `t: true` to word the status after a
  restart.
- **Token**: memory only (`session`, kept by the app for the same
  credentials across a reconnection to Gladys or a saved configuration;
  other credentials, a new session). Renewed by a login 1 h before its
  `expires`; a new `ticket` given by the list replaces it. A 401 to a token
  of an earlier reading makes one login and one more list; a 401 to a
  fresh token is a refusal (never a loop).
- **Refusals**: `status: 2` of the login (or a body with `error`), HTTP 401
  on the login, or a 401 of the list right after a login. Ladder 1 h, 6 h,
  then 24 h, persisted as JSON `{ k: 4 hex of the HMAC of the credentials,
s: step, u: end, p: pending, f: forced, t: terms }` under a salted digest
  of the e-mail address; same rules as gladys-invoxia (context captured
  with the request, written as soon as the answer arrives whatever the
  generation, pending attempt counted, one forced attempt per series when
  the configuration is saved, read-back end capped by its step, any other
  failure within a series waits for the end of the step).
- **Pauses**: HTTP 429 (Retry-After), or a login answered `status: 429`
  (too many attempts, `lockout` seconds), pauses every path, bounded
  max(1 min, poll interval) to 6 h; 5xx for the back-off delay (or a longer
  Retry-After, up to 6 h). Persisted, capped when read back, removed after
  a reading that works. Saving the configuration does not lift a pause.
  Other failures retry from max(1 min, poll interval), doubling up to 1 h,
  the wait kept in `/data`.
- **Glucose unit**: the core has neither mg/dL nor mmol/L
  (`DEVICE_FEATURE_UNITS_BY_CATEGORY`, checked in `server/utils/constants.js`
  at `52dcb652`, and in the SDK 0.15 constants): glucose and targets are
  `unknown`/`decimal` without unit, the unit in the feature name. A setting
  `glucose_unit` (mg/dL by default, mmol/L) chooses the features; the unit
  is part of the feature key (`glucose_mgdl` / `glucose_mmol`,
  `target_low_*`, `target_high_*`) so that a change of the setting never
  gives an existing feature (and its history) values of another unit: the
  features of the new unit are added (never fewer features), the old ones
  stop receiving values. mmol/L = mg/dL ÷ 18.0156, one decimal (the API's
  `Value` in the account's unit is not used: one source, `ValueInMgPerDl`).
  To ask the core for glucose units if users want them.
- **Features** (all read only, `keep_history: false`, health data): glucose;
  trend `unknown`/`integer` 1-5 (pylibrelinkup's `Trend`; 0 or absent: no
  state); measurement age `duration`/`integer` `minutes` (from
  `FactoryTimestamp`, the UTC clock of the sensor; `Timestamp`, local
  without zone, is never used); targets once the API gave a coherent range
  (`targetLow` < `targetHigh`, 10-1000 mg/dL) for that patient (memory),
  or when the created device has them. Glucose outside 10-1000 mg/dL or a
  date that does not parse: no measurement. A measurement dated more than
  a day in the future is dropped.
- **External ids**: `patient:<16 hex of SHA-256("gladys-librelinkup:patient:<patientId>")>`
  (the LibreLinkUp id never appears in Gladys). Device name: first and last
  names of the patient as given (control characters removed), else
  `LibreLinkUp <4 hex>`. Names are shown in Gladys (Discovery, scene
  variables), never logged.
- **Low / high triggers**: thresholds `target` (the account's target low /
  high, when given) and fixed values (54, 70, 80 / 180, 250, 300 mg/dL,
  labels with mmol/L); one event per threshold crossed (required field,
  the core matches it). Only a measurement 15 min old at most (and not more
  than 5 min in the future) of a patient created in Gladys fires; strict
  comparison (below / above). Marked fired once the event left; armed again
  at threshold + 5 mg/dL (low) or - 5 mg/dL (high). **Told at the first
  reading** (unlike the "silent" trigger of gladys-invoxia): a missing
  alert is worse than a repeated one; the memory is in RAM only (no health
  data in `/data`), kept across a reconnection to Gladys, so only a restart
  of the container may tell an ongoing low again. A patient not created
  records nothing (once created, a low still there is told). No event at a
  reading after a clock jump.
- **Stale trigger**: the rules of gladys-invoxia's `device_silent`
  (approved there): thresholds 15, 30, 60, 120, 240 min; created patients
  only; never for a threshold already reached at the first reading, for a
  new patient, nor after a clock jump; re-armed when the age falls under
  15 min or by a newer measurement (above its age). Only evaluated at a
  reading that works: a LibreLinkUp failure tells nothing (the connection
  status does), said in the docs.
- **Event data**: low / high: `device`, `threshold`, `device_name`,
  `glucose` (unit of the configuration), `unit`, `trend`, `measured_at`
  (UTC text); stale: `device`, `minutes`, `device_name`, `stale_for`,
  `measured_at`. Health data in scene variables is on purpose (a
  notification needs it): the docs say so.
- **Poll interval**: 60, 120 (default), 300, 600, 900 s. The sensor gives a
  value about every minute; Abbott is known to slow down accounts read too
  often (HTTP 429), hence 2 min by default.
- **Timeout 30 s per request, test button 60 s** (budget 55 s; a reading
  can take up to four requests: login, region, list, list again).
- **Caps**: 20 patients (created ones first, then in the order of the API),
  answers of 1 MB at most, 250 states/min (the measurement first, then the
  targets), badges in calls of 100, 30 events per reading. One reading at
  a time.
- **Privacy**: no glucose value, trend, date of measurement, patient name or
  id, e-mail address, password, token, user id or region in a log, an error
  message or `/data`; no URL logged. The patient id is digested as soon as
  the list is read. The sensor serial, the alarm rules, the country and the
  invitations of the account are never read into Gladys.
- **Transport badge**: `cloud` when LibreLinkUp answers and the patient is
  in the reading, `unreachable` otherwise. `transports: ["cloud"]`.
- `gladys_version >=5.1.0` (scene triggers). Category `services`. No
  `location: true`.
- **Dates**: every date shown is UTC; `test/timezone.test.js` runs
  `test/app.test.js` again with TZ=Europe/Lisbon and TZ=Europe/Helsinki.
