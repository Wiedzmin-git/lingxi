# Lingxi dev.4 UI polish

Scope: installed desktop version in Settings → General → Updates, softer commented-text highlighting without underlining, removal of the new-session provider promotion. Workspace guidance and persisted dismissal remain supported. The removed provider schema's decode cases now exercise the retained workspace schema in `runtime/persistence/consumers.test.ts`.

## Evidence

- Canonical `bun run check`: 36/36 tasks passed.
- Persistence consumers: 12 tests, 83 assertions passed.
- Changed-file lint: no problems in four TypeScript/TSX files.
- Production quote benchmark before/after: passed with 24 quotes and 50 streamed events. Observed action durations were 134.9 ms / 129.7 ms, with 48 / 24 geometry measurements. These are single observations, not a speedup claim.
- Packaged dev.3 → dev.4 transition: `gui-transition-801aad83-cc67-4668-b8f7-2a69c35c4477`. Same backend PID and exact backend bytes, unchanged profile binding and message context, retained parked-inbox identity, draft and horizontal-tab preference. Staging left the running version untouched.
- In that native dev.4 window: installed version reads `2.0.23-lingxi.dev.4` and permits text selection; real quote creation produces a translucent accent highlight with no text decoration; its numbered marker opens the retained comment.
- Fresh native profile: `upd-d0466d20-6633-41bb-8692-993c3e188834`. Usable composer, absent 75-provider promotion, installed version scrolled into view and photographed, draft retained across settings navigation, no page errors.
- All 34 inventoried backend, Session Link and launcher-helper files match dev.3 byte-for-byte; storage contract is unchanged.
- Independent source review: obsolete test import was found, corrected and re-reviewed; no remaining concrete source finding.

Archive SHA256: `9c506c403bf9f5f594224ac57912a9fe80740afb3169908376bb9eccbcf5089b` (410847620 bytes, 128 inventoried files).

## Limits

Screenshots cover the default GraphiteSoft light appearance. There is no all-theme visual acceptance claim. This patch does not broaden earlier recovery guarantees or claim the previously reported short custom-answer issue is reproduced. Runtime code and styles were verified in the packaged application, not merely inferred from source changes.
