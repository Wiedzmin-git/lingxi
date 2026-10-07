# Desktop 2.0.23-lingxi.dev.2

This GUI hotfix repairs the first-launch layout: the readiness wrapper now supplies
the flex-column sizing required by the application. The old package produced a
zero-height new-session panel and intercepted real composer clicks.

- Both horizontal and vertical tabs support click/type in normal, maximized,
  fullscreen and restored windows, including a 700×450 client area.
- New profiles default to vertical tabs; saved preferences remain authoritative.
- A fast question no longer disappears when an older initial form-list response
  arrives after its creation event. Form settlements also win over stale snapshots.
- Lingxi marks, window/menu titles, About, notifications, Help and launcher update
  instructions replace application-level upstream branding and destinations.
- The mini-mark retains an intentionally empty click handler for a future easter egg.
- Real provider names, backend command identities and upstream credits remain.

## Verification

The actual packaged Windows Desktop passed the 14-case window/layout matrix and
new-session keyboard submission → custom question answer → visible provider
continuation. About shows renderer version `2.0.23-lingxi.dev.2`; Settings shows the
independent launcher instructions. Screenshots and isolated fixture records are
retained by the maintainer.

Client data tests: 32 passed, including a failing-before-fix form creation race,
settlement before cache initialization and simultaneous global location reads.
Settings/native-copy tests: 41 passed. Canonical repository check: 36 tasks passed.
Strict changed GUI file lint: zero problems.

Published dev.1 → hotfix transition also passed with the same running backend PID:
messages, queued input identity, unsent draft, profile binding and an explicitly saved
horizontal-tab preference were preserved. The Session Link host recognizes the
previous bundle's active carrier only after matching policy/connection paths and
byte-comparing its runtime package. Active-generation attestation remains required.
Bootstrap compatibility tests: 6 passed, including changed/missing runtime rejection
and an inactive superseded declaration preceding the compatible active carrier.

## Compatibility and update

The backend remains byte-identical to published dev.1 (`2.0.23-lingxi.dev.1`), with
the same storage contract. This hotfix does not require a database migration.
Stage through **Start → Lingxi → Stage updates**, then close Lingxi when convenient
and open it normally. Staging alone does not activate the candidate.

The separate long-answer truncation fix is source-only and is not in this backend.
The owner's original short-question submission symptom remains unreplicated;
the proven disappearing-form race is not claimed as its explanation. LSP is deferred.
