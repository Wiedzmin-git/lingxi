# MCP Location eviction repair

## Cause and boundary

MCP connections belong to a Location service scope. Closing that scope closes its
transports. The transport's `onClose` callback previously still saw the connection
as the entry's live client and emitted tools/resources/status change notifications.
The connected client refreshed these catalogs, borrowing the just-evicted Location
again and starting its MCP processes again.

Connection callbacks and HTTP-session recovery now require an open owner scope.
An intentional scope teardown does not report a live disconnect. Normal disconnect,
reconnect, configuration removal and genuine transport failures retain their paths.
This does not share MCP instances across Locations or change tool routing.

## Evidence, 2026-10-07

- Working OpenCode observation: 61 loaded Locations; 61 sets of nine Workshop MCPs,
  each using a Python venv launcher and interpreter (1098 Python processes).
  Its log contained 590 boots and 529 evictions. This is not evidence of 1098 orphans.
- Isolated source probes with both config and plugin registration terminated each
  Python launcher/interpreter pair on invalidation. The baseline emitted MCP change
  events during teardown; the patch emitted only `location.shutdown`.
- Copied installed OpenCode binary and the exact published Lingxi backend were tested
  in separate temporary profiles. With the real `createData` client connected,
  baseline eviction immediately rebuilt the Location in all three tested cycles.
- Patched native Windows CLI, real client and Python MCP: ten settled-startup cycles
  of connect → evict → observe, with assertions for empty loaded-Location inventory,
  no teardown catalog events and both child processes dead. All ten passed.
- An earlier probe evicted during initial client startup and rebuilt once from
  outstanding startup reads. The repair is not a cancellation mechanism for already
  admitted client reads; the idle-eviction acceptance waits for startup to settle.
- Owner-scope regression was observed failing without the guard and passing with it.
  The test Bus now records publications when the Effect executes, not when constructed.
- MCP and Location layer suites: **93 passed, 6 skipped, 0 failed, 412 assertions**.
  The Windows descendant-wrapper case remains skipped by its existing fixture.
- Location activity suite: four existing failures reject the additional
  `executionID` field in interrupted events. Running without the MCP patch reproduced
  all four. They are not counted as passing or repaired here.
- Canonical `bun run check`: **36/36 tasks passed**.

The test binary identifies as `2.0.23-lingxi.dev.5`; it is a candidate, not a
published Desktop update. The current public update remains dev.4. Native evidence
does not establish resource reduction in the owner's still-running server.

## C# architecture direction

An explicitly shared Workshop host is a credible C# refactoring target: one host
can own reusable services while request context carries Location, Session and
sender identity. This could remove the per-Location multiplication of nine Python
launcher/interpreter pairs. Its benefit comes from changed ownership, not a language
substitution. Arbitrary third-party MCP servers must retain their configured process,
environment and working-directory isolation. COM apartment requirements, cancellable
long operations, attachment and snapshot lifetime, and identity-preserving routing
must be designed and measured before selecting the final host topology.
