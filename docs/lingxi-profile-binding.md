# Explicit Lingxi profile binding (development)

The recovery branch can address one profile independently of Desktop branding and the release channel. This is a startup-path contract, not an implemented updater or a migration tool.

The launching process supplies both `LINGXI_PROFILE_BINDING` (an absolute path to a JSON descriptor) and `LINGXI_PROFILE_ID` (the exact descriptor UUID). The descriptor is loaded once per process. If either coordinate is missing, invalid or mismatched, startup fails; it does not choose another profile. With neither variable set, the existing OpenCode path behavior remains in effect.

On Windows, the descriptor and every bound path must include a drive or a UNC share. Root-relative paths such as `\profiles\history.db` are rejected because a cwd change can change their drive identity.

Descriptor format:

```json
{
  "format": 1,
  "id": "56118db5-78b7-4b9b-a16f-f9ee6fdbe407",
  "desktopUserData": "C:/Lingxi/Profiles/example/desktop",
  "dataHome": "C:/Lingxi/Profiles/example/data",
  "configHome": "C:/Lingxi/Profiles/example/config",
  "cacheHome": "C:/Lingxi/Profiles/example/cache",
  "stateHome": "C:/Lingxi/Profiles/example/state",
  "database": "C:/Lingxi/Profiles/example/data/opencode/history.db",
  "serviceRegistration": "C:/Lingxi/Profiles/example/state/opencode/service.json",
  "serviceConfig": "C:/Lingxi/Profiles/example/config/opencode/service.json",
  "servicePort": 49301
}
```

These are synthetic example paths and identity. Descriptor creation and selection belong to the owner/launcher. The application reads the descriptor; it does not create it, discover a working profile to adopt, copy databases, or move directories.

- The four `*Home` fields are XDG base directories. OpenCode appends `opencode` to them for its global roots.
- `desktopUserData`, `database`, `serviceRegistration` and `serviceConfig` are exact paths. This permits an explicitly selected existing layout without moving its data.
- Draft/state storage and Session Link continue below the selected Desktop user-data directory. Choosing another brand or channel does not select another identity.
- The bound configuration directory takes precedence over inherited `OPENCODE_CONFIG_DIR`. Managed child processes receive the selected binding coordinates and paths after service-environment overrides are merged.
- Standalone mode, including persisted `disabled: true`, conflicts with a bound managed profile. An explicit mismatching managed port is rejected. The existing-service preservation policy blocks implicit replacement of an incompatible or unavailable registered server.
- A launcher must keep the descriptor stable across a launch attempt. The current contract does not authenticate a mutable descriptor or prove that paths still resolve to the same filesystem objects.

## Verification boundary

Process-isolated tests cover descriptor validation, actual Desktop configuration and CLI path selection across two branded-channel fixtures, production Global service acquisition, a real child-process environment handoff, and rejection of standalone fallback. The fixtures use synthetic files; they do not run native Electron, migrate real SQLite databases, or prove full startup readiness.

Compatible fallback selection, immutable bundles, private-token storage, renderer/server/Session Link readiness and recovery after new messages remain separate implementation and acceptance work. Never restore an older database over newer history as a binary rollback mechanism.
