# Lingxi launcher (Windows, development slice)

Independent .NET 10 launch and recovery coordinator. It preserves the selected
profile and admits explicitly tested backend-version pairs. Native packaged Desktop readiness,
same-profile branded transition and an explicitly compatible failed-candidate
fallback have passed isolated acceptance. The NSIS bootstrap has separate
installation/staging/uninstall acceptance; see the release evidence for its status.

## Build and contract verification

```powershell
dotnet build -c Release
dotnet run --project tests/Lingxi.Launcher.Tests.csproj -c Release
dotnet publish -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true
dotnet publish gui/Lingxi.Start.csproj -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true
```

Tests create isolated profiles, actual child processes and a loopback TLS server.
They require Windows and .NET 10. No GitHub credentials are needed for tests.

Desktop transport tests live under `packages/desktop/src/main/lifecycle/launcher-*.test.ts`.
For the isolated Chromium renderer probe, run `node scripts/test-launcher-renderer.mjs`
from `packages/desktop` after installing workspace dependencies and Playwright Chromium.
It uses the app package's existing Vite/Playwright toolchain and actual DesktopApp/onboarding
components with fixture providers; it does not replace native Desktop acceptance.

## Commands

Desktop shortcuts run `Lingxi.Start.exe <installation-root>`. This Windows GUI
entrypoint calls the same coordinator, owns its lifetime locks, and reports errors
in a native dialog. It has no console, and Desktop creation suppresses a child
console. `Lingxi.Launcher.exe` remains the console entrypoint for the commands below.

```text
initialize <installation-root> <binding.json> <profile-id> <dev|stable>
initialize-new <installation-root> <empty-new-profile-directory> <dev|stable>
status <installation-root>
channel <installation-root> <dev|stable>
stage-local <installation-root> <bundle.zip> <sha256> <bytes>
credential
stage <installation-root>
launch <installation-root>
desktop-check <installation-root>
desktop-stage <installation-root> <bundle-sha256> <dev|stable>
desktop-restart <installation-root> <bundle-sha256> <dev|stable>
```

Use fully qualified paths. The binding follows `docs/lingxi-profile-binding.md`.
Initialization pins its exact bytes and records one installation owner under
`desktopUserData/lingxi-launcher`. Another installation cannot independently claim
the same Desktop profile. Dev/stable are channels of that installation.
`channel` preserves profile identity, current Desktop and the recovery budget. A
different-channel staged candidate is cleared; run `stage` to select the new
channel's bundle. A concurrent staging operation makes the channel change fail
without mutation. A channel change does not activate or restart anything.

The `desktop-*` commands require the active Desktop's exact profile, attempt and
bundle environment binding. `desktop-restart` performs a verified handoff to the
candidate helper, waits for the bound Desktop/supervisor generation to exit and
then launches with explicit active-work continuation admission. It does not kill
the Desktop. A plain `launch` retains observed-idle backend replacement.
See `docs/lingxi-backend-updates.md` for renderer persistence and recovery semantics.

`initialize-new` is for an empty, new profile only. It refuses occupied directories
and never adopts existing history. NSIS uses this on first install and only stages
the supplied bundle on subsequent installs; it does not start Desktop. An existing
root launcher is retained. Shortcuts select the matching supervisor inside the
new immutable bundle. The temporary installer helper can stage while the installed
launcher supervises a running Desktop. Uninstall holds the installation launch lock.

Normal setup refuses a different directory when another Lingxi installation owns
the registered shortcuts. `/PORTABLE /D=<directory>` (with `/D` last) installs without
global shortcuts/uninstall registration. Uninstall retains profile data, bundles,
bindings and journals. See `INSTALL.txt` for the recipient instructions.

## Bundle and installer authoring

Use `scripts/New-LingxiBundle.ps1` on the unpacked output of the Desktop's
`electron-builder.lingxi.config.ts` configuration. Supply an explicit release ID,
exact backend version, evidence-grounded storage contract and only tested fallback
digests. The writer rejects links, inventories each file, normalizes ZIP paths,
uses ordinal ordering and fixed entry timestamps, and refuses existing outputs.
Equal inputs have been checked to produce identical archive bytes.

Compile `installer.nsi` with NSIS Unicode using `/INPUTCHARSET UTF8`, defines
`PAYLOAD`, `BUNDLE_SHA256`, `BUNDLE_BYTES`, and `OUTPUT`. The payload contains the
self-contained `Lingxi.Launcher.exe` and `Lingxi.Start.exe`, `desktop.zip`, upstream `LICENSE.txt`,
runtime `DOTNET-LICENSE.txt` / `DOTNET-NOTICES.txt`, and `INSTALL.txt` as `README.txt`.
Desktop's Electron notices and upstream license travel inside its bundle.

`credential` accepts a token only through hidden interactive console entry and
stores it as a Windows generic credential. Private distribution is fixed to
`Wiedzmin-git/lingxi-releases`, asset `channel.json`. Legacy helpers use tags
`lingxi-channel-dev` / `lingxi-channel-stable`, retained for the same-backend bridge.
Supervisor-capable helpers use `lingxi-runtime-dev` / `lingxi-runtime-stable`.
Stable is not yet promoted. See `docs/lingxi-backend-updates.md` for bootstrap admission.

## Admission and recovery

- ZIP SHA-256 and size are checked before extraction; every file is inventoried.
  The admitted manifest hash is retained outside the bundle directory. Linked,
  duplicate, unlisted and escaping paths are rejected.
- Staging only selects a candidate. Launch uses explicit pinned profile identity,
  bundle digest and attempt identity. Readiness is an authenticated Windows pipe
  exchange with the exact child PID and matching profile/attempt/backend values.
- Primary activation of different bytes requires an equal declared storage contract
   and either the exact backend version or an inventoried exact-pair transition
   contract plus the candidate's allowed fallback digest. Selection/admission serializes with staging/channel changes;
  failure before admission cannot authorize automatic fallback.
- Readiness requires durable Desktop storage, renderer hydration, backend health
  and Session Link binding. Acceptance is committed before ACK. ACK uncertainty
  cannot authorize killing a possibly interactive Desktop or startup fallback.
- A failed startup may launch one explicitly allowed fallback with equal storage
   contract digest and a tested backend pair. Its budget is journaled before creation.
  Crash recovery cannot reconstruct a new budget from adjacent slots.
- Ordinary cleanup retires only the exact unready Desktop. A backend-version update
  uses a separately attested transition plan and observed-idle replacement after
  Desktop has closed. The original and selected executable caches are checked;
  fallback verifies its own exact bundle bytes. A Session Link runtime
  upgrade may restart an observed-idle, attested backend of this installation using
  identical backend bytes. It requires the new recovery-capable supervisor; older
  supervisors refuse that transition before stopping the old service.
- Such an upgrade journals the old registration and every replacement contender
  before readiness. Failed startup retires recorded replacement processes, including
  those not yet registered, before launching fallback. Unknown process admission
  blocks recovery rather than guessing. No profile snapshot replaces newer history.
- The idle check is an observation, not an atomic input barrier. Later-arriving work
  may be interrupted and recovered; tool effects are not guaranteed exactly-once.
- A starting attempt without recorded PID has **unknown process ownership**.
  Automatic recovery blocks; it does not scan processes or assume no child exists.
  Confirmed creation failure or exact-child termination is recorded separately.
- Post-acceptance nonzero exit is reported without startup fallback. The launcher
  normally holds ownership until Desktop exits; surviving recorded children block
  another launch after the launcher itself exits.

The synthetic suite verifies these contracts but does not establish real SQLite
migration compatibility, actual colleague credentials, native renderer reveal,
or complete hard-kill/power-loss recovery. A compatibility digest and allowed
fallback entry must come from release-level acceptance evidence, not guesswork.
