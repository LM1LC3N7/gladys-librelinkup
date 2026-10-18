# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

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
