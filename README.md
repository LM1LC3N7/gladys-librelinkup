# gladys-librelinkup

[Gladys Assistant](https://gladysassistant.com) external integration for
**LibreLinkUp**: the glucose of the FreeStyle Libre sensors shared with a
LibreLinkUp account (the follower app of Abbott). Each patient becomes a
Gladys device (glucose, trend, age of the measurement, targets of the
account), with three scene triggers (glucose low, glucose high, measurement
too old). Read only, through the cloud of Abbott (the API of the
LibreLinkUp app, as the pylibrelinkup library uses it).

**Not a medical device: never use it for a treatment decision; the alerts may be late or missing.**
**Unofficial integration, not affiliated with Abbott. Never tested with a
real account yet.**

User documentation: [docs/en.md](docs/en.md) · [docs/fr.md](docs/fr.md).

## How it works

```
Gladys ⇄ SDK ⇄ src/app.js (LibreApp)
                 ├─ src/llu/client.js   POST /llu/auth/login, GET /llu/connections
                 ├─ src/llu/http.js     the only network access (node:https, no redirect)
                 ├─ src/llu/parse.js    answers -> plain objects (dates, ranges)
                 ├─ src/llu/errors.js   error codes, what a refusal and a stop are
                 ├─ src/budget.js       states per minute
                 ├─ src/store.js        /data: stops, pauses (digests only)
                 └─ src/devices.js      devices (pure), never fewer features
```

- **Access**: a login with the e-mail address and password of the
  LibreLinkUp account (JSON body, https only) gives a token kept in memory
  (Bearer, with the `account-id` header, SHA-256 of the user id), renewed
  by a login before it expires; a 401 makes one login only. The headers of
  the Android app (`product: llu.android`, `version: 4.16.0`, a constant:
  see TODO.md). The region of the account is followed once, only to the
  fixed list of official hosts (`api.libreview.io`, `api-<region>.libreview.io`,
  `api.libreview.ru`).
- **Reading** (every 2 min by default, 1 to 15 min): one `GET
/llu/connections`, the latest measurement and target range of each
  patient. 20 patients at most (created ones first).
- **Stops** (refused credentials, or terms of use / privacy policy / e-mail
  verification asked by the API: never accepted by the integration): 1 h,
  then 6 h, then 24 h (persisted in `/data` with 4 hex of a salted HMAC of
  the credentials, only to see a change; an attempt in flight at a stop
  counts as a refusal); saving the same credentials makes one attempt per
  series. HTTP 429 (or a login locked) and 5xx pause every request
  (Retry-After or lockout, 1 min to 6 h, never under the poll interval,
  kept in `/data`); other failures retry from the poll interval, doubling
  to 1 h (the wait kept in `/data`).
- **Devices**: `patient:<non-secret digest of the patient id>`; glucose
  `unknown`/`decimal` without unit (the core has no glucose unit: the unit
  is in the name and in the feature key, `glucose_mgdl` / `glucose_mmol`),
  trend `unknown`/`integer` (1-5), age `duration`/`integer` minutes,
  targets `unknown`/`decimal`. No history by default.
- **Triggers**: `glucose_low` / `glucose_high` (threshold: the account's
  target or a fixed value; fresh measurements only; once per crossing,
  hysteresis 5 mg/dL; told at the first reading too), `measurement_stale`
  (15 min to 4 h; once per threshold; never at the first reading).
- **Privacy**: no glucose value, trend, date of measurement, patient name or
  id, e-mail address, password or token in the logs or `/data`.

## Development

```bash
npm install
npm test                                        # node --test, no network (loopback only)
npm run lint && npm run format:check
npm run audit                                   # production dependencies
npm run cover                                   # regenerate cover.png
npx github:GladysAssistant/integration-store .  # store admission checks
```

The tests run against the SDK's fake Gladys and a fake LibreLinkUp API
(`test/helpers/fakeLibre.js`), plus loopback http servers for the
transport. No test touches the real LibreLinkUp API or the Internet.

## Credits

- [pylibrelinkup](https://github.com/robberwick/pylibrelinkup) (MIT,
  0.11.2): the API, its login, regions and the shapes of its answers,
  ported to JavaScript (see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)).
- [gladys-invoxia](https://github.com/LM1LC3N7/gladys-invoxia): the
  structure of the app, the retry policy and the "once per threshold"
  trigger.

## Releasing

**Actions → Release → Run workflow** (patch / minor / major): bumps the
version in `package.json` and the manifest, rolls `CHANGELOG.md`, tags, builds
the multi-arch image to GHCR and publishes the GitHub Release.

## License

Apache-2.0.
