# EMF-S02 — small Web Audio player handoff

| Field | Evidence |
| --- | --- |
| Campaign / slice | EMF / `campaign-emf-001` / **EMF-S02 — CLOUD** |
| Disposition | **IN_REVIEW — implementation and local Node checks complete; hosted browser verification pending.** |
| Date | 2026-11-04, America/Chicago |
| Intake | Clean main `43b7f449c0370f22c75463b278b3f50c09a0ee0d`, independently confirmed by `git ls-remote`. An isolated checkout preserves the earlier checkout. |
| Local environment | Linux x86_64, Node 24.22.1, npm 11.9.0, TypeScript 5.9.3, Playwright 1.62.1 |
| Source | Containing S02 implementation tree on `work/emf-s02-player-20261104`; final verified publication and CI pins will be added after readback. |
| Data | Unchanged S01 pack `s01-foundation` revision 1, original six PCM16 WAVs and provenance. |

## Assignment and delivered scope

Only S02: one small Web Audio player, Play/Pause A/B, Now/Next and one cue-checked scheduled A→B transition using a single clock. Windows, macOS and Linux remain targets. Full DJ/request integration, procedural performance, FL/MCP and Mission Control remain later slices; PC S08 is independent.

`src/browser-pack.ts` fetches bounded pack-relative content and validates manifest, bytes/hashes, PCM metadata and rights-evidence presence before decoding. `src/web-audio.ts` implements a context-owned clock, directed-route checks, output-frame cue mapping and the recorded common source lifecycle. `src/player.ts` owns transport, source generation/cancellation, requested/prepared/clock-active state, immediate volume/mute and context suspension. `web/` provides the minimal accessible controls and native offline-render checks. A same-origin Web Lock coordinates cooperating tabs; hiding a page pauses it until explicit Resume. `scripts/serve.ts` is a portable loopback-only static server. `scripts/browser-check.ts` runs isolated native browser checks and captures JSON/screenshots.

The route starts B eight seconds after A's scheduled start, overlaps for four seconds, stops A at twelve seconds and ends B at twenty-four seconds. All source starts, gain envelopes and stops are native audio-clock events. UI timers only display state. [Setup, decisions and limits](../S02_PLAYER.md).

## Verification at this checkpoint

| Check | Actual result | Limit |
| --- | --- | --- |
| Node 24 `npm ci --ignore-scripts` | PASS | Pinned development dependencies; no browser download during install. |
| `npm run check` | **54/54 tests PASS**, 0 skipped | Original 28 plus 3 loader, 16 audio/player and 7 server checks. Transport/source doubles are not native audio evidence. |
| Fixture regeneration | PASS, 7 exact files | Six WAVs and manifest unchanged. |
| Media validation | PASS, all 6 files | Actual bytes, hashes, PCM properties and rights-evidence files. |
| UI ownership failure reproduction | PASS after fix | Independent DOM/lock/context double: failed no-voice Resume releases ownership; no stale source begins. |
| Native browser checks in this workspace | BLOCKED by environment | Cloud browser cannot reach the executor loopback server; file URLs are disallowed. Local Chromium launch fails because the managed workspace denies its required Unix socket. No access restriction was changed. |
| Hosted Windows/macOS/Linux checks | PENDING | Workflow now runs Node checks plus the native browser runner and uploads per-platform artifacts. |
| Physical output / listening | **NOT TESTED** | No physical device or human audition is claimed. |

## Decisions, risks and recovery

Native buffer sources and gain automation are the single selected S02 renderer. Pause suspends the one context, preserving pending and active automation. Stop/replacement cancel both active and future voices and invalidate generation. Async operation guards prevent old decode/resume/preparation from undoing listener control. Late transitions fail visibly without inventing a new cue or loop.

The full three-layer MVP is incomplete. Device loss/sleep, continuous background playback, other browser families, cross-profile/device ownership, physical output and musical quality remain unqualified. Web Locks is an origin/storage-partition coordination mechanism, not an OS audio-device lease. Default recovery is stopped or paused and requires an explicit user action.

Review corrections also suspend the retained timeline after rejected Resume ownership; its focused regression passes. The first hosted Linux run (41902273454, source dddb3c587ba32824f28c054411d80a46747b49d9) decoded all six WAVs and passed the 48 kHz render, then exposed an overly strict 44.1 kHz natural-end assertion. Cue boundaries and sample comparison remain exact; only the already-permitted one-frame native resampler EOF rounding is now explicit and reported. A Windows test teardown ordering defect was corrected by stopping the child before deleting its working directory. Hosted re-verification is pending.

Last verified checkpoint: 54 passing local tests and unchanged validated fixtures. Next verification action is to publish this review branch, inspect the exact remote tree, run hosted CI and resolve any actual browser/test failures before marking S02 complete or advancing Current Tasks. The final closeout must record the successful run/source and remote main/handoff readback.

## Next handoff

**Immediate recovery: finish EMF-S02 — CLOUD verification.** Inspect current branch/main, preserve unrelated changes, then read this handoff and the workflow results. Do not call S02 complete from this provisional record. When S02's bounded checks pass, the primary next implementation slice is **EMF-S03 — CLOUD**, integrating deterministic DJ state/genre/Next/queue/Hold behavior with this player and the S01 control contract. No S03 implementation is authorized by merely preparing this handoff.

**Owner PC action:** S08 FL/MCP may proceed independently using the unchanged S01 pack contract. No PC action is required to unblock cloud development. Overall campaign effort percentage remains unknown.
