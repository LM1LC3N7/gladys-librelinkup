# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

## [0.1.2] - 2026-10-23

## [0.1.1] - 2026-10-18

### Added

- First version, never tested with a real LibreLinkUp account: the patients
  shared with one LibreLinkUp account (FreeStyle Libre sensors), read
  through the cloud of Abbott (the API of the LibreLinkUp app, as
  pylibrelinkup uses it). Read only. Not a medical device: never use it for
  a treatment decision; the alerts may be late or missing.
- One Gladys device per patient: glucose (mg/dL or mmol/L, chosen in the
  configuration), trend, measurement age and the low and high targets of
  the account when the API gives them. No history by default.
- Scene triggers "Glucose low" and "Glucose high" (the account's target or
  a fixed threshold, fresh measurements only, once per crossing) and
  "Measurement too old" (15 minutes to 4 hours).
- Refresh every minute to every 15 minutes (2 minutes by default).
- The region of the account followed only to the official LibreLinkUp
  hosts; terms of use or privacy policy to accept: never accepted, a stop
  that asks to accept them in the app.
- The password kept by Gladys and never shown again, never logged; refused
  credentials stop for 1 h, then 6 h, then 24 h, kept in `/data`; HTTP 429,
  a locked login and 5xx pause every request, bounded and kept in `/data`.
- Button "Test the connection".

### Changed (review before the first release)

- Every glucose and target feature of a device receives its value, each in
  its own unit; the unit setting only chooses what Discovery offers.
- When an answer has no measurement, the measurement age keeps counting
  and "Measurement too old" can fire (never "low" nor "high").
- A login refused with an HTTP 4xx error of the API is a refusal at once;
  a login locked during a series of refusals moves to the next, longer
  stop.
- Unknown trend published as 0; a measurement dated in the future adds a
  warning to the status; "low" / "high" are told again after 15 minutes
  without the patient or between two measurements, and only for a
  measurement first seen 15 minutes ago at most.
- With a slow refresh (15 minutes), a continuous low or high is no longer
  told again at every reading: "told again" needs at least one reading
  missed (15 minutes, or the refresh + 2 minutes if longer). A measurement
  more than a day in the future also triggers the clock warning.
- Docs and trigger descriptions: the delay max(15 minutes, refresh + 2
  minutes) applies both to a patient not read and to the gap between two
  measurements.
- Scene events use the name of the device in Gladys; patient names lose
  invisible and direction characters.
- The token is renewed at half of its life when it is short.
- Docs: the "target" threshold, the age without measurement, where names
  and glucose values go.

[Unreleased]: https://github.com/LM1LC3N7/gladys-librelinkup/compare/v0.1.2...HEAD
[0.1.2]: https://github.com/LM1LC3N7/gladys-librelinkup/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/LM1LC3N7/gladys-librelinkup/releases/tag/v0.1.1
