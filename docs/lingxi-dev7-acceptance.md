# Lingxi dev.7 acceptance

Release identity: `desktop-dev-20261008.7`, Desktop/backend
`2.0.23-lingxi.dev.7`. Private Windows update archive: 410792251 bytes,
SHA256 `ca47403efd0adaac17ba9e17442cbaa79f1a72ae58282e6decb37cea5c580d5f`.

## Delivered behavior

- Content-sized update indicator, measured percentage and average transfer speed,
  estimated time remaining and a distinct verification stage.
- Persistent independent automatic-check and heartbeat preferences. The two-pulse
  heartbeat stops after hover/focus and respects reduced motion.
- History, previously archived conversations and help in settings. Opening an
  archived conversation retains its archive marker. Archive/restore mutations are
  still unavailable in the underlying session action surface.
- Real Restart and apply, with all-window persistence preparation, retry after
  failure, and continued active work for UI-only changes.
- Explicit backend-changing restart admits durable recovery. The fixed recovery
  instruction is a normalized System message; provider-specific wire lowering
  can differ. See [restart semantics](lingxi-backend-updates.md).

## Evidence

All native tests used isolated profiles and copied binaries on a separate hidden
Windows desktop. The working installation was not restarted. Evidence logs live
in the owner's external release workspace, not inside the source repository.

| Contract | Evidence |
| --- | --- |
| Canonical lint/typecheck | `ui7-final-check-2.log`: 36 successful tasks |
| Strict changed-file lint | `ui7-final-lint-3.log`: 0 problems across 38 files |
| Persistence | `ui7-persistence-tests-3.log`: 39 passed; attachment ownership test passed |
| Normalized recovery instruction | 66 core tests passed; removing conversion fails the negative control |
| Native settings, archive, history and draft | `ui7-archive-native-1.log`, exact release archive |
| Real download percentage/speed/ETA | `ui7-progress-3.log`, exact release archive |
| Heartbeat/reduced motion/hover and label width | `ui7-heartbeat-1.log` |
| Published dev.5/dev.6 upgrade paths | `ui7-upgrade-dev5.log`, `ui7-upgrade-dev6.log` |
| Two UI-only restarts, two windows, delayed attachment | `ui7-multiwindow-3.log` |
| Final-archive repeated UI-only restart and reload/close cancellation | `ui7-barrier-cancellation-3.log` |
| Backend-changing active recovery | `ui7-active-recovery-1.log`, isolated successor test version |

Heartbeat, the first dev.5/dev.6 upgrades, and backend-changing recovery were
tested on earlier candidates. Subsequent changes added attachment-producer
tracking and the archive UI; these have their own persistence and final native
coverage. The final restart test starts with the release archive, transitions to
an earlier same-backend candidate, and returns to the exact release digest. It
covers rejected acknowledgement, renderer reload and window close during the
barrier, then two successful restarts with the original backend still active.
It is not final-binary backend-changing recovery evidence.

The progress test downloads the still-published dev.6 asset: 380.4 MB, visible
0–99% samples, 0.4–7.5 MB/s and an observed ETA. The complete downloaded inventory
matches its manifest. Admission correctly refuses the unapproved dev.7 → dev.6
downgrade; this test does not claim successful staging. Earlier runs incorrectly
waited for that staged state and timed out. Queue identity, draft, profile and
backend PID survived the download and refusal.

The final launcher rebuilt from the publication source matches both the tested
launcher and bundled helper byte for byte:
`268065b61353e88a67b647ec53e61423ee8fe0d6bd69d47b83588be18f8edc77`.

## Bounds

With 30 sessions, the five final settings-history openings measured
184.32 / 195.59 / 74.25 / 190.03 / 74.29 ms. The dev.6 Home baseline was
42.41 / 33.88 / 31.01 / 30.07 / 30.14 ms. The new path includes settings-tab
navigation and is slower; no performance improvement is claimed. No renderer
errors occurred in the final navigation or progress runs.

Some early isolated Chromium starts failed before readiness, including
`ERR_INSUFFICIENT_RESOURCES` reports; their broader cause remains unresolved.
The independently reproduced inherited crashpad-pipe failure was fixed and
repeated restarts subsequently passed. Recovery is at-least-once durable
continuation, not universal tool pause/resume or provider backfill. Two-machine,
real-provider and owner-working-process acceptance remain separate.
