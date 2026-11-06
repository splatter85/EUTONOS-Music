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
- Aliases: S02 demo; small player; S03 DJ demo; S04 sampler page; S05 bridge; S06 imported pack checks; S07 linked demo; palette selector
- Summary: Capability: a loopback demo with two linked pages. The DJ page loads the S01 fixture pack (fixture mode on), plays recordings through SmallPlayer and takes DJ requests (state, genre, Next, queue, Hold, cancel, transport, and a handoff choice between crossfade and a procedural bridge); it plays S01 only. Since S07 the sampler page auditions seeded procedural phrases from either the S01 original palette or the S06 imported MOCK palette, chosen by a two-option selector or ?pack=mock-fl, using the selected pack's own recipe and route through the same SmallPlayer; selection is silent and switching requires Stop. The pages live in web/, outside the NAV source roots and not cited; src/browser-pack.ts, src/player.ts, src/dj.ts, the procedural source and src/hybrid-handoff.ts are the cited code. scripts/serve.ts routes /procedural.html, the browser modules and only the JSON, Markdown and WAV files of the mock FL pack under dist/generated/s06-mock-fl/pack/. scripts/browser-check.ts regenerates that MOCK pack (no FL Studio) and runs 23 native offline groups plus 15 Chromium report groups, three of them for S07. Production hosting, arbitrary packs and imported-recording DJ playback are out of scope.
- Evidence: `src/browser-pack.ts`; `src/player.ts`; `scripts/serve.ts`; `scripts/browser-check.ts`
- Related: `SRC-playback`; `SRC-dev-scripts`; `GAP-web-demo-outside-source-roots`; `SURF-demo-http-server`; `JRN-load-pack-play-ab-transition`; `GAP-authored-pack-not-playable-in-demo`
- Review: candidate
- Revision: 6b0bb70ef27113e98ba16dc567efa9376d476bf3f4ebb23d19ee4684158625b5

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
- Summary: Caller-owned WebAudioClock with engine generations, cue-to-frame mapping, route checks and transition planning, a one-shot RecordedSource with fades (its transitionOut also takes a one-off fade length) and a cancelTransition that restores its envelope before the exit, and SmallPlayer, the transport (play, playProcedural, scheduleAB, scheduleHybrid, pause, resume, stop, volume, mute, snapshot, dispose). A transition operation counter lets cancelTransitionPreparation and cancelPendingTransition withdraw an in-flight or future handoff without touching committed audio; snapshot lists voices, transition stamps and the hybrid handoff phase for reconciliation.
- Evidence: `src/playable-source.ts`; `src/web-audio.ts`; `src/player.ts`; `src/browser-pack.ts`
- Related: `SRC-playback`; `SYS-pack-validation`; `SYS-deterministic-dj`; `SYS-procedural-sampler`; `SYS-hybrid-handoff`
- Review: candidate
- Revision: 1da0cff9cc6ca2af793fa89c05f07e646c2e483c2f2169d734448cb31e989188

### `SYS-control-request-contract` Control request acceptance and receipts
- Kind: system
- Aliases: ControlContract; em.control.v0
- Summary: In-memory ControlContract: validates versioned requests (now including cancelQueue, cancelNext and a nullable genre), enforces revision checks, command-id idempotency, a 32-entry manual queue and hold policy, retains receipts for the session, and records requested versus renderer-reported prepared and audible state. It can adopt a new engine generation and take an initial state. It has no server, timers or execution; DeterministicDj executes it.
- Evidence: `src/control.ts`
- Related: `SRC-control-contract`
- Review: candidate
- Revision: e8b9a0ae28ef816f8cdf65792867c0dc64f50d1472d918fbbb26f03205a6454c

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
- Summary: GET and HEAD only static server bound to 127.0.0.1 with a strict allowlist of routes (web pages including procedural.html, dist browser modules including dj, phrase-plan, procedural-source and hybrid-handoff, S01 fixtures, and the JSON, Markdown and WAV files of the generated S06 MOCK pack under /generated/s06-mock-fl/pack/), host-header and path hardening and symlink rejection, exporting createDemoServer; the browser check runner first regenerates the MOCK FL pack (no FL Studio), drives the server with an injected Playwright module, runs 23 native offline checks (including four on the imported mock pack) plus player (crossfade and procedural bridge) and sampler page stages, and since S07 the linked-demo palette selection, context disposal, ownership and failure-recovery stages (15 report groups), and writes evidence.
- Evidence: `scripts/serve.ts`; `scripts/browser-check.ts`
- Related: `SRC-dev-scripts`; `AREA-pack-ab-playback-demo`
- Review: candidate
- Revision: 6b0bb70ef27113e98ba16dc567efa9376d476bf3f4ebb23d19ee4684158625b5

### `GAP-control-contract-unwired` Control contract reaches only the session-local DJ
- Kind: gap
- Aliases: S03 integration done; no Mission Control consumer
- Summary: Resolved in part: src/dj.ts constructs ControlContract and src/index.ts exports DeterministicDj, so the contract now drives SmallPlayer through the DJ, with tests in tests/dj.test.ts. Remaining: nothing under src or scripts exposes it over a server or to Mission Control, and DJ state is session-local with no persistence. Do not treat it as an external API.
- Evidence: `src/control.ts`; `src/player.ts`; `src/index.ts`; `tests/control.test.ts`
- Related: `SYS-control-request-contract`; `SYS-web-audio-transition-player`
- Review: gap
- Revision: e8b9a0ae28ef816f8cdf65792867c0dc64f50d1472d918fbbb26f03205a6454c

### `GAP-web-demo-outside-source-roots` Demo page sources are outside any source family
- Kind: gap
- Aliases: web/ unowned; checks page; procedural page; palette selector
- Summary: web/ (the DJ, checks and procedural pages and their scripts, plus style.css) is not under the configured source roots, so no source family owns it. The DJ and sampler UIs, including the S07 palette selector and demo navigation, are therefore reachable in NAV only through scripts/serve.ts (which routes /procedural.html and the dj, phrase-plan and procedural-source browser modules) and scripts/browser-check.ts (which drives the pages, including the S07 palette selection, failure and recovery groups). Page logic cannot be cited. Resolving this needs web added as a source root or an explicit exclusion.
- Evidence: `scripts/serve.ts`; `scripts/browser-check.ts`
- Related: `AREA-pack-ab-playback-demo`; `SYS-demo-server`
- Review: gap
- Revision: 6b0bb70ef27113e98ba16dc567efa9376d476bf3f4ebb23d19ee4684158625b5

### `GAP-authored-pack-not-playable-in-demo` Authored packs have no route and are not demo-playable
- Kind: gap
- Aliases: fl_build_pack output to player
- Summary: fl_build_pack writes a pack with one recording, empty palettes, recipes and routes, eligibility unreviewed and playback-only owner-local rights. SmallPlayer needs a directed A to B route over two distinct recordings and fixture mode, so an authored pack is not demo-playable, and the DJ catalog would exclude its ineligible recording. Since S06 the sampler accepts any palette meeting the s06-performer-palette@1 contract (src/phrase-plan.ts), but an authored pack has no palette and its playback-only rights forbid sample reuse. The S06 importer (src/importer.ts) is the path for producer deliveries; no source here shows a review step that makes material eligible.
- Evidence: `src/authoring/broker.ts`; `src/web-audio.ts`; `src/pack.ts`; `src/player.ts`
- Related: `JRN-author-sketch-to-pack`; `JRN-load-pack-play-ab-transition`; `INT-fl-build-pack`; `SYS-web-audio-transition-player`
- Review: gap
- Revision: 46ab9be08325ce3a958b203e014b5a12e93ffa9a4e6ff563c19b8ebf807ce8be

### `SYS-deterministic-dj` Deterministic DJ coordinator
- Kind: system
- Aliases: DeterministicDj; S03 DJ; request executor
- Summary: DeterministicDj builds a ControlContract from the loaded pack (sorted recordings the renderer pair supports, loaded, and eligibleForPlayback; a genre catalog derived from them) and executes accepted requests: transport stop, pause, mute, unmute, play; hold; cancelNext; cancelQueue; setState; requestGenre; queueTrack; nextSong. select() prefers the manual FIFO head, else a different eligible recording matching state and genre, then schedules A to B either as the S03 crossfade (SmallPlayer.scheduleAB, the default) or, with the hybrid handoff option or setHandoff('hybrid'), through a seeded procedural bridge (scheduleHybrid, seed from the command ID). Exact retries return the stored operation and a reused id with another body is rejected. snapshot() reconciles scheduled clock events (started, completed, applied, cancelled, superseded, no-match, blocked, failed) and reports prepared and audible state back to the contract; there is no timer, network service or persistence, and device output is not measured.
- Evidence: `src/dj.ts`; `src/control.ts`; `src/player.ts`
- Related: `SYS-control-request-contract`; `SYS-web-audio-transition-player`; `SRC-dj-procedural`; `JRN-dj-request-to-transition`; `INT-dj-request`; `SYS-hybrid-handoff`; `JRN-hybrid-handoff`
- Review: candidate
- Revision: 1da0cff9cc6ca2af793fa89c05f07e646c2e483c2f2169d734448cb31e989188

### `SYS-procedural-sampler` Seeded phrase compiler and finite sampler source
- Kind: system
- Aliases: compilePhrase; compileS01Phrase; ProceduralSource; s04-s01-performer; s06-performer-palette@1
- Summary: compilePhrase(pack, {recipe, seed, state}) turns an explicit uint32 seed and a state (explore or drive) into an immutable eight-bar, 120 bpm plan of at most 256 note events for any recipe whose palette meets the written S06 contract s06-performer-palette@1: 120 BPM 4/4 four-bar phrases with a harmony and the requested state; exactly one drum, percussion, bass and harmony sample; pitched roles with a root and pitch classes inside the recipe harmony, unpitched roles with neither; each sample within its role's gap (maxRoleFrames at its own rate, exact because onsets sit on the sixteenth grid); playback and sample-reuse rights and eligible review (or fixture opt-in). Refusals name the rule; keys, ids, rates and hashes are labels. compileS01Phrase is compilePhrase over s01-recipe@1. ProceduralSource is a finite PlayableSource that schedules every note on the owner's WebAudioClock in one pass, with at most four voices and one per role, exits at the 16-quarter phrase and the 32-quarter end, and fails silent on a stale clock or partial schedule; for S05 it also takes a role-limited lead-in and a role-handoff transitionOut. decodeProceduralSamples rechecks hashes and a decoded-memory budget, and checkProceduralPlan recompiles with the plan's own recipe.
- Evidence: `src/dj.ts`; `src/phrase-plan.ts`; `src/procedural-source.ts`; `src/pack.ts`
- Related: `SRC-dj-procedural`; `SYS-web-audio-transition-player`; `SYS-pack-validation`; `JRN-procedural-audition`; `GAP-authored-pack-not-playable-in-demo`; `SYS-hybrid-handoff`; `SYS-producer-importer`
- Review: candidate
- Revision: 46ab9be08325ce3a958b203e014b5a12e93ffa9a4e6ff563c19b8ebf807ce8be

### `SYS-hybrid-handoff` Checked recording to procedural bridge to recording handoff
- Kind: system
- Aliases: S05 hybrid; s05-hybrid-handoff@1; planHybridHandoff; commitHybridHandoff
- Summary: One code-versioned policy, s05-hybrid-handoff@1, for the S01 pack's A to B route and the S04 performer. planHybridHandoff checks route, performer, recipe, pack revision, tempo, 4/4 meter, key and harmony, bar-aligned cues, A's tail bar, the bridge exit (phrase at 16 quarters or end at 32) and the scheduling lead, and refuses before any audio effect; it returns fromExit, bridgeFull, toStart and end as absolute frames on the one WebAudioClock. commitHybridHandoff schedules the bridge (a ProceduralSource with a percussion-only one-bar lead-in), its role-handoff exit at B's entry (non-percussion attacks cancelled, percussion fading over at most one bar), B at full level, and changes A's exit fade last. bridgeSeed is FNV-1a of a command ID. Timing and fades are engineering choices; nobody has listened.
- Evidence: `src/hybrid-handoff.ts`; `src/procedural-source.ts`; `src/web-audio.ts`; `src/player.ts`
- Related: `SYS-web-audio-transition-player`; `SYS-procedural-sampler`; `SYS-deterministic-dj`; `SRC-dj-procedural`; `INT-schedule-hybrid`; `JRN-hybrid-handoff`
- Review: candidate
- Revision: 1da0cff9cc6ca2af793fa89c05f07e646c2e483c2f2169d734448cb31e989188
### `SYS-producer-importer` Producer delivery importer and import receipt
- Kind: system
- Aliases: importDelivery; IMPORT.json; em.import-receipt.v0; eutonos-music-importer@1
- Summary: importDelivery(delivery, newPack) reads em.producer-delivery.v0 (strict fields, 1 MiB JSON, at most 64 assets, at most 256 MiB read per delivery) through the bounded pack reader, checks optional producer hashes, measures each PCM16 WAV itself, trims a keep_frames tail only at or below 0.001 peak, refuses silent or full-scale audio, listening-review claims and s01- ids, writes canonical 44-byte WAV headers around unchanged PCM, validates with the unchanged pack validator, copies UTF-8 rights evidence (refusing case or folder clashes), and writes a timestamp-free IMPORT.json with per-recipe generator checks and a browser_player check (the unchanged loadBrowserPack in fixture mode over the finished bytes). It runs loadPack and only then renames the folder into place, never over an existing one. Refusals carry a code and location. Producer identity, rights and musical labels are recorded, not verified.
- Evidence: `src/importer.ts`
- Related: `SRC-producer-import`; `SYS-pack-validation`; `SYS-procedural-sampler`; `INT-cli-import-delivery`; `INT-cli-mock-fl-producer`
- Review: candidate
- Revision: 46ab9be08325ce3a958b203e014b5a12e93ffa9a4e6ff563c19b8ebf807ce8be
