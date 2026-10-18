# CLAUDE.md

Project rules for coding assistants (Claude Code reads this file) and for human
contributors.

## What this is

A Gladys Assistant **external integration** for LibreLinkUp (the follower
app of Abbott's FreeStyle Libre sensors): a Node.js service (Node 22+, ESM,
no build step) that runs in its own sandboxed Docker container and talks to
Gladys through
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js),
its only runtime dependency. It reads the patients shared with one
LibreLinkUp account through the API of the LibreLinkUp app (login with the
e-mail address and password, then a token), as the pylibrelinkup library
(MIT) does; that library is ported, not installed. Read only, pull only.
**Health data, and not a medical device.** See `TODO.md` for the status and
every decision.

## Commands

```bash
npm install
npm test                                  # node --test, the built-in runner
node --test test/app.test.js              # one file
node --test --test-name-pattern "429"     # tests whose name matches
npm run lint                              # ESLint
npm run format:check                      # Prettier, as the CI runs it
npm run format                            # Prettier, fix in place
npm run cover                             # regenerate cover.png (plain Node)
npx github:GladysAssistant/integration-store .   # store admission checks
```

The CI (`.github/workflows/ci.yml`) runs `format:check`, `lint` and `test` on
Node 22 and 24, and builds the Docker image: run the three commands before
pushing.

## Architecture

```
index.js                          SDK wiring only (src/handlers.js)
src/handlers.js                   every SDK handler, registered before connect()
src/app.js                        LibreApp: start queue, loop, failures, states, triggers
src/llu/client.js                 POST /llu/auth/login (region, steps), GET /llu/connections
src/llu/http.js                   the only network access (node:https, no redirect)
src/llu/parse.js                  answers -> plain objects (dates, plausible values)
src/llu/errors.js                 error codes; what a refusal and a stop are
src/devices.js                    devices (pure), external ids, never fewer features
src/config.js                     DEFAULTS (mirror the manifest) + normalization
src/store.js                      /data: stops, pauses, salt (digests only)
src/budget.js                     sliding window of the states sent per minute
src/i18n.js                       statuses and messages (en / fr)
gladys-assistant-integration.json manifest
docs/en.md, docs/fr.md            user documentation, re-hosted by Gladys (mandatory)
test/                             node --test, fake Gladys (SDK) + fake LibreLinkUp
```

## Rules

- **External ids are forever**: `patient:<16 hex of SHA-256 of the patient
id>` and the feature keys of `src/constants.js` (the unit is part of the
  glucose and target keys). Changing the digest recipe creates new devices
  and orphans the old ones. The same goes for every key users store:
  manifest `config_schema`, `actions`, the scene trigger keys, their
  fields and their option values.
- **Read only**: no request other than the login and the list of
  connections, no command, and **never** an endpoint that accepts terms of
  use or a privacy policy: a `step` asked by the API stops the reading.
- **Hosts**: only those of `ALLOWED_HOSTS` (`src/constants.js`); a region is
  followed only through the fixed `REGIONS` map, never to a host taken from
  an answer.
- **Health and privacy**: never log a URL, and never put a glucose value, a
  trend, the date of a measurement, a patient name or id, the e-mail
  address, the password or the token in a log, an error message or `/data`.
  Every feature keeps no history by default. The docs keep the bold
  warning: not a medical device, never for a treatment decision, alerts may
  be late or missing.
- **Refusals** (wrong credentials, terms to accept): the stop ladder (1 h,
  6 h, 24 h) must never become a loop (a wrong password tried again and
  again locks the account); a 401 makes one login only.
- **Units**: only those of the core's `DEVICE_FEATURE_UNITS_BY_CATEGORY`;
  it has no glucose unit (the unit goes in the feature name).
- **The container rootfs is read-only.** Write only under `/data`.
- **Versions belong to the Release workflow** (Actions → Release). Never edit
  `version` in `package.json` or in the manifest, nor the `docker_image` tag,
  by hand (0.1.0 was set by hand once, before the first release).
  `test/manifest.test.js` checks they agree. `LLU_VERSION` (the app version
  sent to the API) is a different thing: see `TODO.md`.
- **Changelog.** Every user-visible change adds a line under `## [Unreleased]`
  in `CHANGELOG.md`. Never write a version heading.
- **Manifest.** Texts are `{ "en": ..., "fr": ... }` objects; the catalog
  `description` holds 10 to 100 characters per language.
  `test/manifest.test.js` ties the manifest to the code.
- **Encoding.** Files are UTF-8 without BOM; `test/encoding.test.js` refuses
  mojibake in the manifest, docs, README, CHANGELOG, TODO, CLAUDE.md, the
  notices and `src/**/*.js`. Write files with an editor, never through a
  shell that guesses a code page.
- **pylibrelinkup is MIT**: its notice stays in `THIRD_PARTY_NOTICES.md`,
  copied into the image.
- **Style.** Prettier formats, ESLint catches mistakes. Comments explain why,
  in English. Tests never touch the network (loopback only).
