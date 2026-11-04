# Repository Navigation

Status: SEEDED
Source revision: unresolved

Read this first. Search canonical names and aliases, follow the linked stable
IDs, then inspect current source before editing.

## Common Requests

| Human request | Start at | Why |
| --- | --- | --- |
| Add routes during source review | `GAP-bootstrap` | Replace the bootstrap Gap with reviewed records. |

## Areas, Systems, And Gaps

### `GAP-bootstrap` Navigation map not yet reviewed
- Kind: gap
- Aliases: missing map; bootstrap gap
- Summary: Source-backed repository areas and systems have not yet been established.
- Evidence: docs/ARCHITECTURE.md
- Related: none
- Review: gap
- Revision: unresolved
- History: Retained RNAVL bootstrap identity; source review pending.
- Trigger: Complete the source-family construction stage.
### `AREA-fl-authoring-capability` Agent-driven FL Studio authoring
- Kind: area
- Aliases: FL authoring; MCP authoring; sketch to pack
- Summary: Capability: Claude Code or Codex create a disposable FL project from an allowlisted factory template, edit patterns and tempo, verify, save, render a WAV through the FL command line and turn the render into an `em.audio-pack.v0` pack. Rendering needs the Windows adapter; other platforms get an unsupported-host adapter that still allows offline inspection and edits.
- Evidence: `src/authoring/broker.ts`; `src/authoring/mcp-main.ts`; `src/authoring/mcp-server.ts`; `src/authoring/host.ts`
- Related: `SRC-fl-authoring`; `SURF-mcp-stdio-server`; `SYS-authoring-broker`; `JRN-author-sketch-to-pack`
- Review: candidate
- Revision: 431ecb2e38117c4fc16eb73d6bccf5af54d2bfc0a598686aeb986632649921db

### `AREA-pack-ab-playback-demo` Pack loading and A/B transition playback demo
- Kind: area
- Aliases: S02 demo; small player
- Summary: Capability: a loopback demo loads the S01 fixture pack in the browser (fixture mode on) and plays recording A or B, scheduling a cue-aligned A to B transition through SmallPlayer. web/app.ts, outside the NAV source roots, wires loadBrowserPack and SmallPlayer, requires a secure context with Web Audio, Web Locks and Web Crypto, and takes a Web Lock for playback ownership; web/index.html loads the compiled app. It is fixture-only; arbitrary packs, streaming and production hosting are out of scope per code comments.
- Evidence: `src/browser-pack.ts`; `src/player.ts`; `scripts/serve.ts`; `scripts/browser-check.ts`
- Related: `SRC-playback`; `SRC-dev-scripts`; `GAP-web-demo-outside-source-roots`; `SURF-demo-http-server`; `JRN-load-pack-play-ab-transition`; `GAP-authored-pack-not-playable-in-demo`
- Review: candidate
- Revision: 431ecb2e38117c4fc16eb73d6bccf5af54d2bfc0a598686aeb986632649921db

### `SYS-pack-validation` Audio pack manifest and media validation
- Kind: system
- Aliases: em.audio-pack.v0 validator; pack loader
- Summary: Strict manifest validator (ids, portable paths, cues, palettes, recipes, equal-tempo whole-bar routes with matching constant harmony), playback eligibility (listening-reviewed, or fixture-only when explicitly allowed), PCM16 WAV parsing, SHA-256 and byte/metadata checks against the manifest, and the Node loader that reads packs from a directory with exact-case, in-root path handling. The authoring broker's pack build and the browser pack loader both reuse it.
- Evidence: `src/pack.ts`; `src/audio.ts`; `src/node.ts`; `src/pack-types.ts`
- Related: `SRC-audio-pack-contract`
- Review: candidate
- Revision: 431ecb2e38117c4fc16eb73d6bccf5af54d2bfc0a598686aeb986632649921db

### `SYS-web-audio-transition-player` Web Audio source, transition planning and small player
- Kind: system
- Aliases: RecordedSource; planTransition; SmallPlayer
- Summary: Caller-owned WebAudioClock with engine generations, cue-to-frame mapping, route checks and transition planning, a one-shot RecordedSource with fades, and SmallPlayer, the A/B transport (play, scheduleAB, pause, resume, stop, volume, mute, snapshot, dispose) that cancels stale voices through an operation counter and reacts to AudioContext state changes.
- Evidence: `src/playable-source.ts`; `src/web-audio.ts`; `src/player.ts`; `src/browser-pack.ts`
- Related: `SRC-playback`; `SYS-pack-validation`
- Review: candidate
- Revision: 431ecb2e38117c4fc16eb73d6bccf5af54d2bfc0a598686aeb986632649921db

### `SYS-control-request-contract` Control request acceptance and receipts
- Kind: system
- Aliases: ControlContract; em.control.v0
- Summary: Pure in-memory ControlContract: validates versioned requests, enforces revision checks, command-id idempotency, a 32-entry manual queue and hold policy, retains receipts for the session, and records requested versus renderer-reported audible state. It has no server, timers or execution of its own.
- Evidence: `src/control.ts`
- Related: `SRC-control-contract`
- Review: candidate
- Revision: 431ecb2e38117c4fc16eb73d6bccf5af54d2bfc0a598686aeb986632649921db

### `SYS-authoring-broker` FL authoring broker: lease, lock, journal, revisions
- Kind: system
- Aliases: Broker; writer lease; operation journal
- Summary: Single project writer shared by every MCP client process through files in a private workspace: per-project writer lease with TTL, cross-process exclusive-create locks that break stale owners, a JSONL operation journal giving idempotent replay by caller operation id and reconcile of unfinished operations, SHA-256 revisions, pre-mutation backups with restore, prepared changes, named saves, host-exclusive render with MIDI readback verification, and pack building. Agents pass validated ids, never paths.
- Evidence: `src/authoring/broker.ts`; `src/authoring/errors.ts`
- Related: `SRC-fl-authoring`; `SYS-flp-codec`; `SYS-fl-host-adapter`; `SYS-pack-validation`
- Review: candidate
- Revision: 431ecb2e38117c4fc16eb73d6bccf5af54d2bfc0a598686aeb986632649921db

### `SYS-mcp-server` EUTONOS Music MCP stdio server
- Kind: system
- Aliases: eutonos-music MCP; McpSession; fl_* tools
- Summary: Dependency-free newline-delimited JSON-RPC 2.0 MCP server: protocol negotiation, tools/list, tools/call with JSON Schema argument checks before broker code, one queued call at a time per process, structured error results and redaction of the workspace path. It exposes the sixteen fl_* tools. mcp-main.ts picks the Windows host on win32 and otherwise the unsupported host.
- Evidence: `src/authoring/mcp-server.ts`; `src/authoring/mcp-main.ts`; `src/authoring/schema.ts`
- Related: `SRC-fl-authoring`; `SYS-authoring-broker`
- Review: candidate
- Revision: 431ecb2e38117c4fc16eb73d6bccf5af54d2bfc0a598686aeb986632649921db

### `SYS-flp-codec` FLP and MIDI file codec
- Kind: system
- Aliases: flp.ts; smf.ts; FL project codec
- Summary: Portable clean-room reader and writer of FL Studio project event streams, with note and playlist decoding, project views, tempo, note and pattern-length edits, restricted to a verified FL 24.x layout and rejecting others; plus a minimal Standard MIDI File reader used for host-side note readback.
- Evidence: `src/authoring/flp.ts`; `src/authoring/smf.ts`
- Related: `SRC-fl-authoring`
- Review: candidate
- Revision: 431ecb2e38117c4fc16eb73d6bccf5af54d2bfc0a598686aeb986632649921db

### `SYS-fl-host-adapter` FL Studio host adapter boundary
- Kind: system
- Aliases: HostAdapter; WindowsFlHost; UnsupportedHost
- Summary: HostAdapter interface (info, running instances, renderWav, exportMidi, template path). WindowsFlHost finds FL64.exe, refuses with HOST_BUSY when an FL GUI is running or detection fails, and runs the official CLI render and MIDI export with a timeout. UnsupportedHost reports the platform as unavailable and refuses render and export.
- Evidence: `src/authoring/host.ts`; `src/authoring/host-windows.ts`
- Related: `SRC-fl-authoring`
- Review: candidate
- Revision: 431ecb2e38117c4fc16eb73d6bccf5af54d2bfc0a598686aeb986632649921db

### `SYS-fixture-pipeline` Deterministic fixture generator and pack CLI
- Kind: system
- Aliases: generate-fixtures; validate-pack
- Summary: Pure seeded generator of the S01 fixture pack (two integer-synthesized recordings, manifest and files) with a --check mode that compares against checked-in files, and a CLI that validates a pack directory through the shared loader.
- Evidence: `scripts/generate-fixtures.ts`; `scripts/validate-pack.ts`
- Related: `SRC-dev-scripts`; `SYS-pack-validation`
- Review: candidate
- Revision: 431ecb2e38117c4fc16eb73d6bccf5af54d2bfc0a598686aeb986632649921db

### `SYS-demo-server` Loopback demo server and browser check runner
- Kind: system
- Aliases: serve.ts; browser-check.ts
- Summary: GET and HEAD only static server bound to 127.0.0.1 with a strict allowlist of routes (web page, dist browser modules, S01 fixtures), host-header and path hardening and symlink rejection, exporting createDemoServer; the browser check runner drives it with an injected Playwright module and writes evidence.
- Evidence: `scripts/serve.ts`; `scripts/browser-check.ts`
- Related: `SRC-dev-scripts`; `AREA-pack-ab-playback-demo`
- Review: candidate
- Revision: 431ecb2e38117c4fc16eb73d6bccf5af54d2bfc0a598686aeb986632649921db

### `GAP-control-contract-unwired` Control contract has no inspected consumer
- Kind: gap
- Aliases: S03 integration pending
- Summary: Within src, scripts, tests and a grep of web/, only tests/control.test.ts and the src/index.ts re-export reference ControlContract; SmallPlayer and web/app.ts do not use it, and the player comment defers DJ/control integration to S03. Do not treat the control contract as reachable at runtime.
- Evidence: `src/control.ts`; `src/player.ts`; `src/index.ts`; `tests/control.test.ts`
- Related: `SYS-control-request-contract`; `SYS-web-audio-transition-player`
- Review: gap
- Revision: 431ecb2e38117c4fc16eb73d6bccf5af54d2bfc0a598686aeb986632649921db

### `GAP-web-demo-outside-source-roots` Demo page sources are outside any source family
- Kind: gap
- Aliases: web/ unowned; checks page
- Summary: web/ (app.ts, checks.ts, index.html, checks.html, style.css) is not under the configured source roots, so no source family owns it and the demo UI is only reachable in NAV through SRC-dev-scripts and the playback family. A manual read of web/app.ts (not citable as evidence, outside obtained source) shows it imports loadBrowserPack and SmallPlayer. Resolving this needs web added as a source root or an explicit exclusion.
- Evidence: `scripts/serve.ts`; `scripts/browser-check.ts`
- Related: `AREA-pack-ab-playback-demo`; `SYS-demo-server`
- Review: gap
- Revision: 431ecb2e38117c4fc16eb73d6bccf5af54d2bfc0a598686aeb986632649921db
### `GAP-authored-pack-not-playable-in-demo` Authored packs have no route and are not demo-playable
- Kind: gap
- Aliases: fl_build_pack output to player
- Summary: fl_build_pack writes a pack with one recording, empty palettes, recipes and routes, eligibility unreviewed and playback-only owner-local rights. SmallPlayer needs a directed A to B route over two distinct recordings and checkedRoute demands fixture mode, which admits only fixture-only audio, while eligibleForPlayback otherwise needs listening-reviewed. So the authoring journey does not currently continue into the demo player, and no source here shows a review step that would make it eligible.
- Evidence: `src/authoring/broker.ts`; `src/web-audio.ts`; `src/pack.ts`; `src/player.ts`
- Related: `JRN-author-sketch-to-pack`; `JRN-load-pack-play-ab-transition`; `INT-fl-build-pack`; `SYS-web-audio-transition-player`
- Review: gap
- Revision: 431ecb2e38117c4fc16eb73d6bccf5af54d2bfc0a598686aeb986632649921db
