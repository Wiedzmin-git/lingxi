# Backend updates through the Lingxi lamp

## Delivery boundary

An installation keeps its pinned profile. Staging does not activate a Desktop or
restart its backend. The owner selected activation after closing and reopening
Lingxi, with an observed-idle check. This is not an atomic admission barrier:
input arriving after that observation may be interrupted and recovered; tool
effects are not rolled back.

The old supervisor cannot accept a different backend version and installed
shortcuts point inside an immutable old bundle. Delivery therefore has two steps:

1. The legacy `lingxi-channel-dev` feed offers a same-backend bridge. Its accepted
   Desktop helper redirects only exact installation-owned startup and staging
   shortcuts, preserving previous link files. It creates `installation/Lingxi.lnk`
   for the portable route. Foreign/custom shortcuts are retained.
2. After the redirected shortcut really launches the new supervisor, a separate
   live PID/start-time receipt admits the helper to `lingxi-runtime-dev`. Merely
   installing new supervisor bytes does not admit the new backend feed.

The legacy feed stays on the bridge. Installation and bundle wire shapes remain
readable by the old supervisor, which still finishes its journal on Desktop exit.
Subsequent checks refresh owned shortcuts; retained helpers delegate staging to
the verified current helper before acquiring its stage lock.

## Exact-pair admission and recovery

For a changed backend, the candidate must have the same storage contract, list
the exact previous bundle in `allowedFallbacks`, and inventory
`resources/lingxi-updater/backend-transition.json`:

```json
{ "format": 1, "backendVersion": "<candidate backend>", "from": ["<previous bundle SHA256>"] }
```

These declarations carry release acceptance evidence; their strings alone do not
prove compatibility. The supervisor verifies previous bundle bytes, any live old
process's cache path and bytes, and the registration snapshot. It writes a plan
bound to the profile, bundle and launch attempt. Desktop validates that plan and
the unchanged registration, writes recovery state before discovery, checks idle,
then calls `Service.stop({ expected, pty: "handoff" })`. Ordinary `ensure` still
preserves existing services and journals every replacement contender.

Before launcher acceptance, renderer reconnect requests observe initial startup
instead of spawning another service outside its recovery journal. On failure,
the supervisor retires recorded replacement contenders, handles a stale original
registration using its previous version, and blocks unknown process admission or
foreign registration. A live original is retained. The fallback's exact cache
bytes are verified, or restored from its immutable bundle if absent. An outgoing
stopped cache defect does not invalidate a healthy fallback.

If an already accepted newer bundle fails on a later startup, its admitted pair
also authorizes the reverse transition. The old bundle need not name a future
version. Each startup episode retains a one-fallback budget. No profile snapshot
overwrites history written by the failed candidate. Committed acceptance cannot
authorize same-episode startup rollback.

## Isolated verification, 2026-10-07

Launcher contract suite: 20 passing cases. Canonical workspace check: 36/36.
Native tests use fresh profiles, copied immutable binaries and synthetic provider
responses. They do not activate the owner's installation.

Tested archive pair:

| Desktop | Backend | Bundle SHA256 |
| --- | --- | --- |
| `2.0.23-lingxi.dev.5` bridge | `2.0.23-lingxi.dev.1` | `b93703ee1abc763fbf7d6c43fca124820c2c5bb7d995620cb7a5168fc4269d80` |
| `2.0.23-lingxi.dev.6` | `2.0.23-lingxi.dev.5` | `c25c4422b7d54ca2151fca55138e2baa0d9160040b1bb18198b373eb8580dfad` |

The backend has independent version numbering. Its repaired CLI SHA256 is
`1f073be68c9010204e2109b13f41394b67b801e78518ce803707146cc6f67a04`;
the previous CLI is
`d8a5fac07bdb0f48ec6566aa2f42d25b891116de149f38ffe9b6d8769bb893ce`.

Native evidence retained by the release owner:

- `backend-bootstrap-ff83f575-9b6e-423b-908c-0007aa18cc19`: published dev.3
  supervisor starts bridge, actual redirected Windows shortcut starts the new
  supervisor; profile and backend PID retained.
- `gui-transition-66384d64-a8f6-4c7b-8044-917350753264`: real version upgrade,
  then injected later-startup failure and exact previous backend recovery.
- `gui-transition-5a2907c0-3466-405f-a844-b8934519a0c7`: active work refuses
  the transition, preserving original backend PID.
- `gui-transition-4c016054-3566-4fce-959c-c36b2cd2178f`: failure after new
  process creation but before its registration; old version restored.
- `gui-transition-620dc789-96d7-4893-b733-681ee5415cf0`: failure after new
  registration; old version restored.
- `gui-transition-887f76c1-ab12-4534-8c34-db9f0a874f4c`: original process
  killed after transition admission; stale registration cleared and old version restored.
- `preacceptance-reconnect-b3a19cb9-4734-4338-a8e8-d62e0ee17482`: actual raw
  reconnect IPC while acceptance is withheld replays initial outcome; after stopping
  the original service it does not create an unjournaled replacement.

Transition runs verify exact cached backend bytes, unchanged profile descriptor,
message context, parked inbox identity, composer draft and tab-layout preference.
These checks do not establish two-PC/provider acceptance, every Session Link
delivery state, arbitrary power-loss recovery or atomic input quiescence.

GUI acceptance must run on a separate hidden Windows desktop: a background shell
alone does not prevent native windows from stealing the owner's focus.
