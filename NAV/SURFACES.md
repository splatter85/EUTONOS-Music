# Repository Surfaces

Status: SEEDED
Source revision: unresolved

Human-addressable screens, pages, routes, commands, APIs, scenes, and
meaningful interactions belong here. Decorative labels do not.

## Surfaces And Interactions

<!-- Add SURF-* and INT-* records using SCHEMA.md. -->
### `SURF-mcp-stdio-server` EUTONOS Music MCP stdio entry
- Kind: surface
- Aliases: mcp-main; eutonos-music MCP
- Summary: Parent surface for agents: `node dist/src/authoring/mcp-main.js` reads newline-delimited JSON-RPC from stdin, writes responses to stdout and logs to stderr, using the default workspace and the Windows or unsupported host adapter. Its children are the sixteen fl_* tools, recorded in a later sweep. How a client launches it (configuration) is outside the inspected source.
- Evidence: `src/authoring/mcp-main.ts`; `src/authoring/mcp-server.ts`
- Related: `SYS-mcp-server`; `AREA-fl-authoring-capability`
- Review: candidate
- Revision: 431ecb2e38117c4fc16eb73d6bccf5af54d2bfc0a598686aeb986632649921db

### `SURF-demo-http-server` Loopback demo HTTP server
- Kind: surface
- Aliases: serve.ts; npm run demo
- Summary: Parent surface: `node dist/scripts/serve.js [--port N]` serves the demo pages and assets on 127.0.0.1 (default port 4173) over GET and HEAD from an allowlist and prints the local URL. The allowlist covers /procedural.html, the dj, phrase-plan, procedural-source and hybrid-handoff browser modules and, since S06, only the JSON, Markdown and WAV files under /generated/s06-mock-fl/pack/ (and its audio/ folder), mapped to the MOCK pack generated in dist/ and never committed. `npm run demo` regenerates that pack before serving. Page content comes from web/, outside the source roots.
- Evidence: `scripts/serve.ts`
- Related: `SYS-demo-server`; `GAP-web-demo-outside-source-roots`
- Review: candidate
- Revision: 46ab9be08325ce3a958b203e014b5a12e93ffa9a4e6ff563c19b8ebf807ce8be

### `SURF-dev-cli-scripts` Fixture, pack validation and browser check commands
- Kind: surface
- Aliases: generate-fixtures; validate-pack; browser-check
- Summary: Parent surface of three Node commands: generate-fixtures.js [--check] [dir], validate-pack.js <pack-directory> (prints a JSON PASS report or exits 1, 2 on bad usage) and browser-check.js [--browser] [--playwright-module] [--output] (default output artifacts/s07-browser; starts the demo server on an ephemeral loopback port, runs offline audio checks and drives the player and sampler pages with Playwright). The npm script names live in package.json, outside the source roots.
- Evidence: `scripts/generate-fixtures.ts`; `scripts/validate-pack.ts`; `scripts/browser-check.ts`
- Related: `SYS-fixture-pipeline`; `SYS-demo-server`
- Review: candidate
- Revision: 6b0bb70ef27113e98ba16dc567efa9376d476bf3f4ebb23d19ee4684158625b5

### `SURF-library-exports` Package import surfaces
- Kind: surface
- Aliases: index.ts; node.ts
- Summary: Programmatic entry points: src/index.ts is the browser-safe export barrel (types, pack validation, audio, sources, control, Web Audio, browser pack, player, dj, phrase-plan, procedural-source and, for S05, hybrid-handoff) and src/node.ts is the separate Node-only filesystem loader. No package exports map was inspected.
- Evidence: `src/index.ts`; `src/node.ts`
- Related: `SYS-pack-validation`; `SRC-audio-pack-contract`; `SYS-deterministic-dj`; `SYS-procedural-sampler`; `SYS-hybrid-handoff`
- Review: candidate
- Revision: 1da0cff9cc6ca2af793fa89c05f07e646c2e483c2f2169d734448cb31e989188

### `INT-fl-create-project` fl_create_project: create a disposable project
- Kind: interaction
- Aliases: create FL project; new sketch
- Summary: MCP tool: copies an allowlisted FL factory template (only `fl-factory/create-a-chord-progression` is listed in the host adapter) into the private workspace as a new project under a caller operation_id. Never touches user projects.
- Evidence: `src/authoring/mcp-server.ts`; `src/authoring/broker.ts`
- Related: `SURF-mcp-stdio-server`; `SYS-authoring-broker`
- Review: candidate
- Revision: 431ecb2e38117c4fc16eb73d6bccf5af54d2bfc0a598686aeb986632649921db

### `INT-fl-acquire-writer` fl_acquire_writer: take the writer lease
- Kind: interaction
- Aliases: writer lease; lock project
- Summary: MCP tool: takes the single per-project writer lease (ttl 30 to 3600 s, default 900). Fails with LEASE_CONFLICT while another client holds an unexpired lease; fl_apply_edit and fl_restore require it.
- Evidence: `src/authoring/mcp-server.ts`; `src/authoring/broker.ts`
- Related: `SURF-mcp-stdio-server`; `SYS-authoring-broker`
- Review: candidate
- Revision: 431ecb2e38117c4fc16eb73d6bccf5af54d2bfc0a598686aeb986632649921db

### `INT-fl-prepare-edit` fl_prepare_edit: dry-run a musical edit
- Kind: interaction
- Aliases: edit notes; change tempo
- Summary: MCP tool: validates an edit against an exact expected revision without changing the project. Targets name pattern and channel by index and expected name and give the full replacement note list; optional tempo_bpm and clip_bars. Returns a change_id and predicted after_revision; stale revisions refuse with TARGET_CHANGED.
- Evidence: `src/authoring/mcp-server.ts`; `src/authoring/broker.ts`
- Related: `SURF-mcp-stdio-server`; `SYS-authoring-broker`
- Review: candidate
- Revision: 431ecb2e38117c4fc16eb73d6bccf5af54d2bfc0a598686aeb986632649921db

### `INT-fl-apply-edit` fl_apply_edit: apply a prepared edit
- Kind: interaction
- Aliases: apply change
- Summary: MCP tool: applies a prepared change under the writer lease with a journal record, backup of the before-revision, atomic write and a file readback. Refuses if FL has the project open (HOST_BUSY) or the project changed since prepare; a repeated operation_id replays the recorded outcome.
- Evidence: `src/authoring/mcp-server.ts`; `src/authoring/broker.ts`
- Related: `SURF-mcp-stdio-server`; `SYS-authoring-broker`
- Review: candidate
- Revision: 431ecb2e38117c4fc16eb73d6bccf5af54d2bfc0a598686aeb986632649921db

### `INT-fl-verify` fl_verify: FL-side readback
- Kind: interaction
- Aliases: verify notes with FL
- Summary: MCP tool: has FL Studio load the saved project through the CLI MIDI export and compares channel notes and tempo with the project file. Requires FL to be closed.
- Evidence: `src/authoring/mcp-server.ts`; `src/authoring/broker.ts`
- Related: `SURF-mcp-stdio-server`; `SYS-authoring-broker`
- Review: candidate
- Revision: 431ecb2e38117c4fc16eb73d6bccf5af54d2bfc0a598686aeb986632649921db

### `INT-fl-save` fl_save: write a named checkpoint
- Kind: interaction
- Aliases: checkpoint; save project
- Summary: MCP tool: writes a named, hash-checked checkpoint copy (label plus revision prefix) of the current project into the project saves folder.
- Evidence: `src/authoring/mcp-server.ts`; `src/authoring/broker.ts`
- Related: `SURF-mcp-stdio-server`; `SYS-authoring-broker`
- Review: candidate
- Revision: 431ecb2e38117c4fc16eb73d6bccf5af54d2bfc0a598686aeb986632649921db

### `INT-fl-render` fl_render: render WAV with FL
- Kind: interaction
- Aliases: render audio; export wav
- Summary: MCP tool: renders the current revision to WAV through the FL command line under the cross-process host lock, then checks the file. Needs FL closed; returns a render_id used by fl_verify_export and fl_build_pack.
- Evidence: `src/authoring/mcp-server.ts`; `src/authoring/broker.ts`
- Related: `SURF-mcp-stdio-server`; `SYS-authoring-broker`
- Review: candidate
- Revision: 431ecb2e38117c4fc16eb73d6bccf5af54d2bfc0a598686aeb986632649921db

### `INT-fl-build-pack` fl_build_pack: build an audio pack from a render
- Kind: interaction
- Aliases: make pack; em.audio-pack.v0
- Summary: MCP tool: verifies the render and builds and validates an `em.audio-pack.v0` pack in the workspace packs folder. Needs a 4/4 source, bars 1 to 64 with phrase_bars dividing bars, and a new pack_id; eligibility is left unreviewed.
- Evidence: `src/authoring/mcp-server.ts`; `src/authoring/broker.ts`
- Related: `SURF-mcp-stdio-server`; `SYS-authoring-broker`
- Review: candidate
- Revision: 431ecb2e38117c4fc16eb73d6bccf5af54d2bfc0a598686aeb986632649921db

### `INT-fl-restore` fl_restore: restore a backup revision
- Kind: interaction
- Aliases: undo; rollback
- Summary: MCP tool, marked destructive: under the writer lease replaces the project with a backup revision chosen from fl_list_backups, keeping the replaced revision as a backup first; needs the current expected_revision.
- Evidence: `src/authoring/mcp-server.ts`; `src/authoring/broker.ts`
- Related: `SURF-mcp-stdio-server`; `SYS-authoring-broker`
- Review: candidate
- Revision: 431ecb2e38117c4fc16eb73d6bccf5af54d2bfc0a598686aeb986632649921db

### `INT-fl-operation-status` fl_operation_status: reconcile an operation
- Kind: interaction
- Aliases: recover unknown outcome
- Summary: MCP tool: looks up an operation by caller id and, for one that started without a recorded outcome, decides from files on disk whether it took effect and journals that result. Use before retrying after OUTCOME_UNKNOWN.
- Evidence: `src/authoring/mcp-server.ts`; `src/authoring/broker.ts`
- Related: `SURF-mcp-stdio-server`; `SYS-authoring-broker`
- Review: candidate
- Revision: 431ecb2e38117c4fc16eb73d6bccf5af54d2bfc0a598686aeb986632649921db
### `SURF-demo-main-page` Demo main page route
- Kind: surface
- Aliases: demo home; slash route
- Summary: Child of the demo server: GET or HEAD `/` serves `web/index.html`. The page's contents are in web/, outside obtained source, so its controls are not mapped here.
- Evidence: `scripts/serve.ts`
- Related: `SURF-demo-http-server`; `GAP-web-demo-outside-source-roots`; `JRN-load-pack-play-ab-transition`
- Review: candidate
- Revision: 431ecb2e38117c4fc16eb73d6bccf5af54d2bfc0a598686aeb986632649921db

### `SURF-demo-checks-page` Demo checks page route
- Kind: surface
- Aliases: checks.html; browser checks page
- Summary: Child of the demo server: GET or HEAD `/checks.html` serves `web/checks.html`. Its contents and purpose beyond the filename were not read.
- Evidence: `scripts/serve.ts`
- Related: `SURF-demo-http-server`; `GAP-web-demo-outside-source-roots`
- Review: candidate
- Revision: 431ecb2e38117c4fc16eb73d6bccf5af54d2bfc0a598686aeb986632649921db

### `INT-fl-capabilities` fl_capabilities: discover what authoring supports
- Kind: interaction
- Aliases: what can FL authoring do
- Summary: Read-only MCP tool: returns contract and bridge versions, host info, the writer model, supported, partial and unsupported operations (no channel creation, plugins, mixer edits, render settings or live GUI edits) and template ids.
- Evidence: `src/authoring/mcp-server.ts`; `src/authoring/broker.ts`
- Related: `SURF-mcp-stdio-server`; `SYS-authoring-broker`
- Review: candidate
- Revision: 431ecb2e38117c4fc16eb73d6bccf5af54d2bfc0a598686aeb986632649921db

### `INT-fl-list-projects` fl_list_projects: list workspace projects
- Kind: interaction
- Aliases: list projects
- Summary: Read-only MCP tool: lists workspace projects that have a project.json, with template origin and current revision hash.
- Evidence: `src/authoring/mcp-server.ts`; `src/authoring/broker.ts`
- Related: `SURF-mcp-stdio-server`; `SYS-authoring-broker`
- Review: candidate
- Revision: 431ecb2e38117c4fc16eb73d6bccf5af54d2bfc0a598686aeb986632649921db

### `INT-fl-inspect` fl_inspect: read a saved project
- Kind: interaction
- Aliases: inspect project; get revision
- Summary: Read-only MCP tool: returns revision, FL version, tempo, meter, channels, patterns with note counts (notes if include_notes), playlist clips, the current writer lease and whether an FL window holds the project. The revision it returns is the expected_revision for fl_prepare_edit.
- Evidence: `src/authoring/mcp-server.ts`; `src/authoring/broker.ts`
- Related: `SURF-mcp-stdio-server`; `SYS-authoring-broker`
- Review: candidate
- Revision: 431ecb2e38117c4fc16eb73d6bccf5af54d2bfc0a598686aeb986632649921db

### `INT-fl-release-writer` fl_release_writer: release the writer lease
- Kind: interaction
- Aliases: release lease
- Summary: MCP tool: releases the lease this client holds; reports released false if no lease, and refuses with LEASE_CONFLICT when another client holds it.
- Evidence: `src/authoring/mcp-server.ts`; `src/authoring/broker.ts`
- Related: `SURF-mcp-stdio-server`; `SYS-authoring-broker`
- Review: candidate
- Revision: 431ecb2e38117c4fc16eb73d6bccf5af54d2bfc0a598686aeb986632649921db

### `INT-fl-verify-export` fl_verify_export: re-check a render
- Kind: interaction
- Aliases: verify render
- Summary: Read-only MCP tool: for a render_id re-inspects the WAV (PCM16, length, silence, clipping), compares its hash with render.json and confirms the rendered source copy; returns ok, problems and provenance.
- Evidence: `src/authoring/mcp-server.ts`; `src/authoring/broker.ts`
- Related: `SURF-mcp-stdio-server`; `SYS-authoring-broker`
- Review: candidate
- Revision: 431ecb2e38117c4fc16eb73d6bccf5af54d2bfc0a598686aeb986632649921db

### `INT-fl-list-backups` fl_list_backups: list restorable revisions
- Kind: interaction
- Aliases: list backups
- Summary: Read-only MCP tool: lists the SHA-256 revisions of pre-mutation backups that fl_restore accepts.
- Evidence: `src/authoring/mcp-server.ts`; `src/authoring/broker.ts`
- Related: `SURF-mcp-stdio-server`; `SYS-authoring-broker`
- Review: candidate
- Revision: 431ecb2e38117c4fc16eb73d6bccf5af54d2bfc0a598686aeb986632649921db

### `INT-cli-generate-fixtures` generate-fixtures: write or check fixture pack
- Kind: interaction
- Aliases: regenerate fixtures
- Summary: Command `node dist/scripts/generate-fixtures.js [--check] [output-directory]`: writes the deterministic fixture files, or with --check verifies existing files byte for byte; usage errors and differences exit 1.
- Evidence: `scripts/generate-fixtures.ts`
- Related: `SURF-dev-cli-scripts`; `SYS-fixture-pipeline`; `JRN-fixture-pack-regenerate-validate`
- Review: candidate
- Revision: 431ecb2e38117c4fc16eb73d6bccf5af54d2bfc0a598686aeb986632649921db

### `INT-cli-validate-pack` validate-pack: validate a pack directory
- Kind: interaction
- Aliases: validate pack
- Summary: Command `node dist/scripts/validate-pack.js <pack-directory>`: loads and validates a pack, prints a JSON PASS report, exits 1 on validation failure and 2 on bad usage.
- Evidence: `scripts/validate-pack.ts`
- Related: `SURF-dev-cli-scripts`; `SYS-pack-validation`; `JRN-fixture-pack-regenerate-validate`
- Review: candidate
- Revision: 431ecb2e38117c4fc16eb73d6bccf5af54d2bfc0a598686aeb986632649921db

### `INT-cli-browser-check` browser-check: run isolated browser checks
- Kind: interaction
- Aliases: check browser; Playwright check
- Summary: Command `node dist/scripts/browser-check.js [--browser PATH] [--playwright-module PATH] [--output DIR]` (default output artifacts/s07-browser): first regenerates the MOCK FL pack under dist/generated/s06-mock-fl (generateMockPack; no FL Studio), starts the demo server on an ephemeral loopback port, runs twenty-three native offline audio checks (nine recorded, six procedural, four S05 hybrid handoff, four S06 imported-producer), then drives the player page (including a live A to bridge to B stage) and the sampler page with Playwright. Since S07 it also checks entry from the DJ page to the imported mock palette, silent selection with no AudioContext, palette-specific status, same-seed palette comparison, closure of the old context on switch, imported transport, ownership and navigation, missing, corrupt and unknown palettes with same-palette retry, refresh and mobile fit (15 report groups). Writes offline.json, browser.json and screenshots, or failure.json on error; reports physical output and listening as NOT TESTED.
- Evidence: `scripts/browser-check.ts`
- Related: `SURF-dev-cli-scripts`; `SYS-demo-server`
- Review: candidate
- Revision: 6b0bb70ef27113e98ba16dc567efa9376d476bf3f4ebb23d19ee4684158625b5

### `SURF-demo-procedural-page` Demo procedural sampler page route
- Kind: surface
- Aliases: procedural.html; sampler page; palette selector; ?pack=mock-fl
- Summary: Child of the demo server: GET or HEAD `/procedural.html` serves `web/procedural.html`, the page for auditioning seeded procedural phrases (S04). Since S07 the optional query `?pack=s01` or `?pack=mock-fl` picks the S01 original or the S06 imported mock palette, and the DJ page links to it. The route is in scripts/serve.ts; the page's controls are in web/, not cited, and are not mapped here.
- Evidence: `scripts/serve.ts`
- Related: `SURF-demo-http-server`; `GAP-web-demo-outside-source-roots`; `AREA-pack-ab-playback-demo`
- Review: candidate
- Revision: 6b0bb70ef27113e98ba16dc567efa9376d476bf3f4ebb23d19ee4684158625b5

### `INT-dj-request` DJ request: execute a control request
- Kind: interaction
- Aliases: DeterministicDj.request; operation; snapshot
- Summary: Library call request(request, ownership?) on DeterministicDj, with operation(commandId) and snapshot() for polling. Accepts the em.control.v0 request types, including the cancelQueue and cancelNext types and a nullable genre added for S03; rejections use the contract's codes, such as manual-only, missing-queue-entry and queue-full. The web page that drives it is under web/ and is not cited.
- Evidence: `src/dj.ts`; `src/control.ts`
- Related: `SYS-deterministic-dj`; `SYS-control-request-contract`; `JRN-dj-request-to-transition`; `SURF-library-exports`
- Review: candidate
- Revision: e8b9a0ae28ef816f8cdf65792867c0dc64f50d1472d918fbbb26f03205a6454c

### `INT-play-procedural` SmallPlayer.playProcedural: audition a seeded phrase
- Kind: interaction
- Aliases: procedural audition; sampler play
- Summary: Library call playProcedural(plan, ownership?) compiles nothing itself: it takes a plan from compilePhrase (any recipe whose palette meets the S06 s06-performer-palette@1 contract) or compileS01Phrase, rechecks it against the loaded pack with the plan's own recipe, decodes the palette once, and plays the finite source through the same transport, clock, pause, mute and stop as recordings. A different palette after the first is refused until reload. The procedural.html page (under web/, not cited) is served by scripts/serve.ts; since S07 it compiles with the selected pack's own recipe and builds a new SmallPlayer per palette, choosing the S01 original or the S06 imported mock palette.
- Evidence: `src/player.ts`; `src/procedural-source.ts`; `scripts/serve.ts`
- Related: `SYS-procedural-sampler`; `JRN-procedural-audition`; `SYS-demo-server`
- Review: candidate
- Revision: 6b0bb70ef27113e98ba16dc567efa9376d476bf3f4ebb23d19ee4684158625b5

### `INT-schedule-hybrid` SmallPlayer.scheduleHybrid: schedule A to bridge to B
- Kind: interaction
- Aliases: scheduleHybrid; hybrid handoff call
- Summary: Library call scheduleHybrid(bridgePlan, exit = 'phrase') while A plays: plans with planHybridHandoff, decodes the palette (shared with playProcedural) and B, prepares both, plans again, then commits; a late or changed clock refuses and releases what was prepared, leaving A unchanged. snapshot().handoff reports the policy, bridge identity (recipe, performer, seed, state, exit), boundaries and a clock-derived phase: scheduled, lead-in, bridge, tail or complete. Cancel works until the bridge enters; Stop stays immediate.
- Evidence: `src/player.ts`; `src/hybrid-handoff.ts`
- Related: `SYS-hybrid-handoff`; `SYS-web-audio-transition-player`; `JRN-hybrid-handoff`
- Review: candidate
- Revision: 1da0cff9cc6ca2af793fa89c05f07e646c2e483c2f2169d734448cb31e989188
### `INT-cli-import-delivery` import-delivery: import a producer delivery
- Kind: interaction
- Aliases: npm run import
- Summary: Command `node dist/scripts/import-delivery.js <delivery-directory> <new-pack-directory>` (npm run import --): runs importDelivery and prints a JSON IMPORTED report (pack, manifest hash, producer, per-asset frames, kept frames and peak, generator checks and limits); prints the refusal and exits 1 on failure, 2 on bad usage. Refuses an existing output folder.
- Evidence: `scripts/import-delivery.ts`
- Related: `SYS-producer-importer`; `SRC-producer-import`
- Review: candidate
- Revision: 46ab9be08325ce3a958b203e014b5a12e93ffa9a4e6ff563c19b8ebf807ce8be

### `INT-cli-mock-fl-producer` mock-fl-producer: generate and import the MOCK FL pack
- Kind: interaction
- Aliases: npm run mock:fl; generateMockPack
- Summary: Command `node dist/scripts/mock-fl-producer.js [--out <directory>]` (npm run mock:fl; also run by npm run demo and browser-check): drives the S08 broker through McpSession JSON-RPC against MockFlHost, which synthesizes 44.1 kHz stereo renders with exact arithmetic; writes a CC0 fixture-only delivery with a MOCK provenance file to <out>/delivery and imports it to <out>/pack (default dist/generated/s06-mock-fl). It replaces only a folder carrying its own marker file, and prints the pack path, manifest hash and generator checks with the note that no FL Studio ran and listening is NOT TESTED.
- Evidence: `scripts/mock-fl-producer.ts`
- Related: `SRC-producer-import`; `SYS-producer-importer`; `SYS-demo-server`
- Review: candidate
- Revision: 46ab9be08325ce3a958b203e014b5a12e93ffa9a4e6ff563c19b8ebf807ce8be
