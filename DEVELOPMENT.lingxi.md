# Lingxi source development

This is an in-development fork based on OpenCode 2.0.23. Use **Bun 1.4.2**, the version pinned in `package.json`. Run `bun install --frozen-lockfile` at the repository root. On Windows, use `bun install --frozen-lockfile --linker hoisted`: this was verified in the initial checkout and avoids an observed nested Babel package path failure. Avoid running installation through a SUBST drive: Bun can record absolute workspace paths in that mode.

## Checks

- Root: `bun run check` (lint and type checks).
- `packages/client`: `bun run generate` after protocol changes.
- Package-local tests: use `bun test` in the owning package, never at the repository root.
- `packages/desktop/resources/session-link`: `node --test test/*.test.mjs` with Node 24. This initially covers profile bootstrap; the previous independent native/browser Session Link harness has not yet been imported. No complete public Session Link acceptance suite is claimed.

## Desktop and CLI must come from the same checkout

The inherited upstream `dev` prebuild downloaded a published upstream CLI. Lingxi prebuild instead requires `OPENCODE_CLI_DIST` for every channel so that it cannot silently substitute that backend.

The following PowerShell commands describe the Windows x64 baseline build route. Run the first command from `packages/cli`, then the remaining commands from `packages/desktop`:

```powershell
# packages/cli; --outdir is disposable build output, never a release archive.
bun run script/build.ts --target=opencode-windows-x64-baseline --skip-install --outdir=dist-lingxi

# packages/desktop
$env:OPENCODE_CLI_DIST = (Resolve-Path ../cli/dist-lingxi).Path
$env:OPENCODE_CHANNEL = 'dev'
bun run prebuild
bun run build
```

The route is subject to verification in this fork; it is not a release recipe or permission to replace a running installation. Use an isolated test profile and explicit test server. The inherited development launcher and service discovery require review before connecting them to existing personal sessions.

Product branding, private channels, persistent profile binding, and readiness-based recovery are still under development. Do not publish installers using inherited upstream update feeds or signing/release automation. Repository Actions are disabled during establishment of Lingxi's own release workflow.

## Profile bootstrap

New Session Link profiles begin with no external senders. Their owner configures integrations explicitly. Existing `policy.json` files are preserved byte-for-byte; branding is not authorization to regenerate invitations, tokens, or installation identities.

## Initial source-import verification (2026-10-07)

- Core job, execution, shell and subagent suites: **115 passed, 63 skipped, 0 failed**.
- Desktop packaging/prebuild checks: **8 passed**. Session Link bootstrap: **1 passed**.
- Type checks passed for all 11 selected application packages: core, desktop, app, gui-extensions, session-ui, ui, client, plugin, protocol, schema and server.
- Full repository checks are **not green**: the clean Windows hoisted installation exposes a Vite 7/8 plugin type mismatch in the inherited console app. Full oxlint reports 0 errors and 11,678 warnings; the stricter changed-file lint also fails on the imported code. These are retained follow-up work, not waived release acceptance.
- No new Lingxi installer or automatic recovery has been accepted. Earlier local runtime/UI evidence is not a substitute for testing the eventual packaged Lingxi release.
