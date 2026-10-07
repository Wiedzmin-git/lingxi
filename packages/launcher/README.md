# Lingxi launcher (Windows, development slice)

Independent .NET 10 launch and recovery coordinator. It does not replace the
OpenCode server or migrate a working profile. Native Desktop acceptance and the
first launcher installer are still pending.

## Build and contract verification

```powershell
dotnet build -c Release
dotnet run --project tests/Lingxi.Launcher.Tests.csproj -c Release
dotnet publish -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true
```

Tests create isolated profiles, actual child processes and a loopback TLS server.
They require Windows and .NET 10. No GitHub credentials are needed for tests.

Desktop transport tests live under `packages/desktop/src/main/lifecycle/launcher-*.test.ts`.
For the isolated Chromium renderer probe, run `node scripts/test-launcher-renderer.mjs`
from `packages/desktop` after installing workspace dependencies and Playwright Chromium.
It uses the app package's existing Vite/Playwright toolchain and actual DesktopApp/onboarding
components with fixture providers; it does not replace native Desktop acceptance.

## Commands

```text
initialize <installation-root> <binding.json> <profile-id> <dev|stable>
status <installation-root>
stage-local <installation-root> <bundle.zip> <sha256> <bytes>
credential
stage <installation-root>
launch <installation-root>
```

Use fully qualified paths. The binding follows `docs/lingxi-profile-binding.md`.
Initialization pins its exact bytes and records one installation owner under
`desktopUserData/lingxi-launcher`. Another installation cannot independently claim
the same Desktop profile. Dev/stable are channels of that installation.

`credential` accepts a token only through hidden interactive console entry and
stores it as a Windows generic credential. Private distribution is fixed to
`Wiedzmin-git/lingxi-releases`: tags `lingxi-channel-dev` / `lingxi-channel-stable`,
asset `channel.json`. Those channel releases are not yet published.

## Admission and recovery

- ZIP SHA-256 and size are checked before extraction; every file is inventoried.
  The admitted manifest hash is retained outside the bundle directory. Linked,
  duplicate, unlisted and escaping paths are rejected.
- Staging only selects a candidate. Launch uses explicit pinned profile identity,
  bundle digest and attempt identity. Readiness is an authenticated Windows pipe
  exchange with the exact child PID and matching profile/attempt/backend values.
- Readiness requires durable Desktop storage, renderer hydration, backend health
  and Session Link binding. Acceptance is committed before ACK. ACK uncertainty
  cannot authorize killing a possibly interactive Desktop or startup fallback.
- A failed startup may launch one explicitly allowed fallback with equal storage
  contract digest and backend version. Its budget is journaled before creation.
  Crash recovery cannot reconstruct a new budget from adjacent slots.
- Cleanup only retires the exact unready child. The detached shared backend is
  not killed. No profile snapshot is restored over newer history.
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
