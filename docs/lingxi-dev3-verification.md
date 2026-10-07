# Lingxi dev.3 acceptance

Desktop version: `2.0.23-lingxi.dev.3`. Backend bytes remain dev.1:
`d8a5fac07bdb0f48ec6566aa2f42d25b891116de149f38ffe9b6d8769bb893ce`.

## Verified contracts

- In-app automatic offer, real private-feed download with visible progress, editable
  composer during download, verified staging without restart, preserved draft,
  queue identity, profile and backend PID: final r5 acceptance
  `upd-fa77b19e-12d3-481c-aaef-4787cb2e4751`.
- First-use GraphiteSoft and native auto-approve switch asserted in that run.
  Saved explicit preferences take precedence (settings suite: 22 passed).
- Stale digest rejected through raw renderer MessagePort IPC without staging or
  restarting: `upd-bf1ee827-e611-4780-9b43-741c6556ad3c`.
- Real model-facing local tools: default wakes idle; steer wakes idle; ordinary
  delivery waits behind busy work; schemas expose only wake/steer. Remote receive
  admission wakes both modes and retains reverse-address identity:
  `lingxi-modes-dGnKnx`, also asserting busy steer precedes queued work at a safe
  boundary. This is loopback/native evidence, not a two-PC claim.
- dev.2 → r4 controlled runtime replacement preserves context, parked queue ID,
  draft, tab preference, binding and backend bytes:
  `gui-transition-de764acf-8a95-4cb5-a361-0e739292912a`.
- Fault after replacement readiness but before Desktop acceptance recovers dev.2
  and preserved data: `gui-transition-5e06f82e-efe5-4a37-ac5d-d33a0ebc70b8`.
- Final r5 killed after durable contender PID receipt but before backend registration
  recovers dev.2 and preserved data, removes recovery marker:
  `gui-transition-9a036a02-626c-4a94-90c7-cee1a2d0764b`.
  The same failure recovers dev.1:
  `gui-transition-1795be81-5f25-4309-9707-8a1ac48a7c2d`.
- Launcher suite: 17 passed, including real unregistered-child retirement, stale
  original registration and uncertain admission. Client service suite: 14 passed,
  including both Promise/Effect spawn journals and expected-generation stop guards.
- Canonical lint/type-check: `bun run check` exit 0 (r5).
- Final installer, bundled GUI supervisor, active reinstall/staging and uninstall
  refusal, preserved database/draft/binding/journal and unchanged protocol routing:
  `installer-7235feb6-60f7-4312-be86-ff3284042790`.

## Distribution and scope

First upgrade from dev.1/dev.2 requires the new installer and its updated shortcut.
The old launcher cannot perform the new plugin-runtime transition. Installation
does not migrate storage or activate a running Desktop. Profiles and old bundles
are retained. Unknown pre-PID creation and ACK-delivery windows are not claimed as
fully automated recovery; stable promotion and two-PC provider acceptance remain
separate. Independent release and recovery reviews found no remaining source blocker
after the recorded corrections.
