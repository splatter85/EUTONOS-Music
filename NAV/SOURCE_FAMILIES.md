# Repository Source Families

Status: SEEDED
Source revision: unresolved

Map major implementation, model, persistence, configuration, generated-owner,
and verification families. A source family is a bounded inspection route, not
a claim that every file in a directory shares one owner.

## Source Families

<!-- Add SRC-* records using SCHEMA.md. -->
### `SRC-audio-pack-contract` Audio pack contract and validation
- Kind: source-family
- Aliases: em.audio-pack.v0; pack loader; S01 foundation
- Summary: Types, manifest validation, PCM16 WAV reading, hashing and the Node file reader for `em.audio-pack.v0` packs; `src/index.ts` is the browser-safe export surface and `src/node.ts` the only Node filesystem boundary.
- Evidence: `src/pack-types.ts`; `src/pack.ts`; `src/audio.ts`; `src/node.ts`; `src/index.ts`
- Related: `SYS-pack-validation`; `SURF-library-exports`; `JRN-fixture-pack-regenerate-validate`
- Review: candidate
- Revision: 431ecb2e38117c4fc16eb73d6bccf5af54d2bfc0a598686aeb986632649921db

### `SRC-playback` Playback clock, sources and small player
- Kind: source-family
- Aliases: S02 player; Web Audio renderer; RecordedSource
- Summary: Caller-owned audio clock and playable-source interface, Web Audio recorded source and transition planning, browser pack loading/decoding and the SmallPlayer A/B transport state machine.
- Evidence: `src/playable-source.ts`; `src/web-audio.ts`; `src/player.ts`; `src/browser-pack.ts`
- Related: `SYS-web-audio-transition-player`; `AREA-pack-ab-playback-demo`; `JRN-load-pack-play-ab-transition`; `GAP-authored-pack-not-playable-in-demo`
- Review: candidate
- Revision: 431ecb2e38117c4fc16eb73d6bccf5af54d2bfc0a598686aeb986632649921db

### `SRC-control-contract` Control request contract
- Kind: source-family
- Aliases: em.control.v0; DJ request contract
- Summary: Versioned control requests (transport, state, queue), limits, receipts, rejection codes and snapshots; the contract a later DJ and Mission Control call.
- Evidence: `src/control.ts`
- Related: `SYS-control-request-contract`; `GAP-control-contract-unwired`; `JRN-control-request-lifecycle`
- Review: candidate
- Revision: 431ecb2e38117c4fc16eb73d6bccf5af54d2bfc0a598686aeb986632649921db

### `SRC-fl-authoring` FL Studio authoring MCP facade
- Kind: source-family
- Aliases: S08; eutonos-music MCP server; authoring broker
- Summary: Single-writer broker (lease, locks, journal, revisions, backups, reconcile), clean-room FLP codec, MIDI reader, host adapter boundary with the Windows FL CLI adapter, and the dependency-free stdio MCP server with argument schema checks.
- Evidence: `src/authoring/broker.ts`; `src/authoring/errors.ts`; `src/authoring/flp.ts`; `src/authoring/host-windows.ts`; `src/authoring/host.ts`; `src/authoring/mcp-main.ts`; `src/authoring/mcp-server.ts`; `src/authoring/schema.ts`; `src/authoring/smf.ts`
- Related: `AREA-fl-authoring-capability`; `SYS-authoring-broker`; `SYS-mcp-server`; `SYS-flp-codec`; `SYS-fl-host-adapter`; `JRN-author-sketch-to-pack`; `JRN-project-revision-lifecycle`
- Review: candidate
- Revision: 431ecb2e38117c4fc16eb73d6bccf5af54d2bfc0a598686aeb986632649921db

### `SRC-dev-scripts` Fixture generation, demo server and checks
- Kind: source-family
- Aliases: npm scripts; fixtures generator; demo server
- Summary: Offline deterministic fixture generator, loopback-only demo server, browser check runner and the pack validation CLI used by `npm run check`.
- Evidence: `scripts/browser-check.ts`; `scripts/generate-fixtures.ts`; `scripts/serve.ts`; `scripts/validate-pack.ts`
- Related: `SYS-fixture-pipeline`; `SYS-demo-server`; `SURF-dev-cli-scripts`; `SURF-demo-http-server`
- Review: candidate
- Revision: 431ecb2e38117c4fc16eb73d6bccf5af54d2bfc0a598686aeb986632649921db

### `SRC-tests` Node test suites
- Kind: source-family
- Aliases: tests; node:test
- Summary: node:test suites for packs, fixtures, control, sources, Web Audio, player, server, browser pack loading and the authoring broker/MCP server; `tests/audio-double.ts` is a shared test double, not a suite.
- Evidence: `tests/audio-double.ts`; `tests/authoring.test.ts`; `tests/browser-pack.test.ts`; `tests/control.test.ts`; `tests/fixtures.test.ts`; `tests/pack.test.ts`; `tests/player.test.ts`; `tests/server.test.ts`; `tests/source.test.ts`; `tests/web-audio.test.ts`
- Related: `SRC-audio-pack-contract`; `SRC-playback`; `SRC-control-contract`; `SRC-fl-authoring`; `SRC-dev-scripts`
- Review: candidate
- Revision: 431ecb2e38117c4fc16eb73d6bccf5af54d2bfc0a598686aeb986632649921db
