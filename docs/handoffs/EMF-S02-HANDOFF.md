# EMF-S02 — small Web Audio player handoff

| Field | Evidence |
| --- | --- |
| Campaign / slice | EMF / `campaign-emf-001` / **EMF-S02 — CLOUD** |
| Disposition | **COMPLETE for the assigned small-player engineering scope.** Full standalone MVP, physical output and listening acceptance remain open. |
| Date | 2026-11-04, America/Chicago |
| Inspected intake | Clean `main` at `43b7f449c0370f22c75463b278b3f50c09a0ee0d`, confirmed against GitHub before editing and again before publication. An isolated checkout preserved the earlier checkout; no unrelated changes were overwritten. |
| Tested source | [`c7f75321bf034517fd0b2fde41298285b89f26b9`](https://github.com/splatter85/EUTONOS-Music/commit/c7f75321bf034517fd0b2fde41298285b89f26b9), tree `433493c05ee4d04fa5705cd82a094ff2dc5204c9`. Review branch: `work/emf-s02-player-20261104`. |
| Data revision | Unchanged S01 `s01-foundation@1`, schema `em.audio-pack.v0`; original two recordings and four sample inputs. |
| Local environment | Linux x86_64, Node 24.22.1, npm 11.9.0, TypeScript 5.9.3; pinned development-only Playwright 1.62.1. |
| Hosted evidence | [Successful run 41903543079](https://github.com/splatter85/EUTONOS-Music/actions/runs/41903543079), exact tested source above. [Retained reports and screenshots](../evidence/emf-s02/README.md). |

## Assignment and delivered scope

The assignment was one small Web Audio player with Play/Pause A/B, Now/Next and a cue-checked scheduled A→B transition using one clock, while preserving Windows/macOS/Linux portability. This slice implements that bounded result. The full DJ, S01 request/queue integration, procedural performer, importer, FL/MCP bridge and Mission Control adapter remain later work. PC S08 remains independent.

| Area | Delivered behavior / source |
| --- | --- |
| Validated browser loading | `src/browser-pack.ts` loads bounded pack-relative responses; validates schema, media byte counts/hashes/PCM properties, rights-evidence presence and explicit fixture eligibility before decoding. It preserves validated bytes when the native decoder detaches its input. |
| One clock and recorded source | `src/web-audio.ts` implements `WebAudioClock`, checked directed-route planning and the S01 `PlayableSource` seam using native buffer sources and gain automation. Starts, offsets, envelopes and stops use the same context's output-frame domain. |
| Small transport | `src/player.ts` owns one AudioContext, at most two current/future voices, generation cancellation, Play A/B, Pause/Resume, Stop, Volume/Mute and clock-derived Now/Next. Async operation guards prevent stale preparation/resume from undoing later transport actions. |
| Minimal browser page | `web/` exposes the controls, pending/current states, transition guide and native offline check page. Same-origin Web Locks coordinate cooperating tabs; hiding pauses until explicit Resume. No context or sound starts on initial load. |
| Portable launch and tests | `scripts/serve.ts` serves an allowlisted set of files on loopback; `scripts/browser-check.ts` starts that server and a fresh Chromium instance together, captures JSON/screenshots and fails on a check error. CI runs Node 24 and Chromium checks on all three OSes. |

The unchanged fixture route is A's `exit` at quarter 16 → B's `entry` at quarter 0, with an eight-quarter overlap at 120 BPM. Relative to A's scheduled start, B enters at **8 seconds**, the four-second complementary linear fade ends and A stops at **12 seconds**, and B naturally ends at about **24 seconds**. Native resampling can change natural EOF by one output frame; cue boundaries remain exact. UI animation reads the timeline and never triggers musical events. The existing S01 control contract is deliberately not presented as integrated DJ behavior.

## Reproduce

Use **Node 24.x** from the repository root on Windows, macOS or Linux:

```sh
npm ci --ignore-scripts
npm run check
npm run demo
```

Open **http://127.0.0.1:4173/** in a browser supporting Web Audio, Web Crypto and Web Locks. Press **Play A**, then **Schedule A → B** before A's eight-second exit; requests inside the 100 ms scheduling lead fail visibly and leave A unchanged. Play B also works independently. Pause freezes pending/active automation; Resume continues it; Stop cancels both current and future voices. Use one origin/port for all demo tabs. Ctrl+C stops the local server.

For the reproducible browser runner:

```sh
npx playwright install chromium
npm run check:browser
```

A fresh Linux host may need `npx playwright install --with-deps chromium`. The runner writes ignored `artifacts/s02-browser/`. Alternatively open **http://127.0.0.1:4173/checks.html** and press **Run offline checks**. See [S02 setup and lifecycle policy](../S02_PLAYER.md) for details and optional port/binary arguments.

## Executed verification

### Portable Node and fixture checks

Local `npm ci --ignore-scripts` and `npm run check` passed. The complete suite has **54 tests, 54 passing, zero skipped**: the original 28 S01 tests, 3 browser-loader tests, 6 Web Audio source/clock tests, 10 player tests and 7 real-HTTP/server/CLI tests. It covers cue conversion, selected-entry subtraction, stale/late/duplicate plans, Stop/Pause/replacement during pending work, suspension/recovery, denied ownership, corrupt/missing media and server path/method/host limits.

The same check passed on all hosted platforms below. Deterministic regeneration compared **all seven fixture files byte-for-byte**; media validation checked **all six WAVs**. S01 fixtures, schema, source contract and request/queue contract were not changed. Transport test doubles verify calls and state, not native rendering or physical output.

| Runner / OS | Node / npm | `npm run check` | Native browser checks |
| --- | --- | --- | --- |
| [Ubuntu 26.04.1 LTS](https://github.com/splatter85/EUTONOS-Music/actions/runs/41903543079/job/126832006821) (`ubuntu-26.04`) | v24.22.1 / 11.19.1 | 54/54; fixture/media PASS | 7 offline checks and live browser groups PASS |
| [Microsoft Windows Server 2025 10.0.26100 Datacenter](https://github.com/splatter85/EUTONOS-Music/actions/runs/41903543079/job/126832007193) (`windows-2025-vs2026`) | v24.22.2 / 11.19.1 | 54/54; fixture/media PASS | 7 offline checks and live browser groups PASS |
| [macOS 26.6.2](https://github.com/splatter85/EUTONOS-Music/actions/runs/41903543079/job/126832006128) (`macos-26-arm64`) | v24.22.1 / 11.19.1 | 54/54; fixture/media PASS | 7 offline checks and live browser groups PASS |

All browser jobs used **Playwright 1.62.1 / Chromium 151.0.7922.34**. Runner OS/image facts come from job logs, not the browser's compatibility user-agent string.

### Native audio rendering

Each OS passed all **seven native offline checks**: manifest/provenance/hash validation, explicit fixture permission, native decoding of six WAVs, A→B rendering at 48 kHz and 44.1 kHz, silence after cancelling a future source plus stale-plan rejection, and a diagnostic pickup/nonzero-entry render. The transition tests use the actual runtime source and planner, compare every sample against a separately calculated offset/envelope expectation, and require finite, non-silent, unclipped output.

| Platform | Maximum sample error, 48 kHz | Maximum sample error, 44.1 kHz | Peak, 44.1 kHz | Natural EOF delta, 48 / 44.1 kHz |
| --- | --- | --- | --- | --- |
| Linux | 3.27062007e-07 | 3.30006826e-07 | 0.456904709 | 0 / −1 frame |
| Windows | 3.27062007e-07 | 3.30006826e-07 | 0.456904709 | 0 / −1 frame |
| macOS | 3.8311584e-08 | 3.67730923e-08 | 0.45690468 | 0 / −1 frame |

The maximum permitted absolute sample error is **0.000003**. At 48 kHz, 1,176,000 samples are compared per platform; at 44.1 kHz, 1,080,450 are compared. The renderer starts A at 0.25 seconds for the test, so B entry/handoff occur at absolute frames **396000/588000** at 48 kHz and **363825/540225** at 44.1 kHz. The 44.1 kHz native decoder returns 705599 frames for each nominal 705600-frame recording: natural B EOF is one frame early, approximately 22.7 microseconds. That accepted decoder rounding does not move B's cue or A's scheduled stop, and the numerical sample tolerance was not widened.

Cancelled future audio rendered **all-zero samples**. The diagnostic 44.1 kHz buffer included a one-second pickup and a nonzero entry at source second nine; its impulse appeared exactly at expected output frame **11029**. This diagnostic does not alter or promote the committed musical fixtures.

### Native browser behavior and visual checks

All three jobs passed the live browser groups: A→B with Now/Next and frozen Pause/Resume; mute's UI indicator; independent Play B and same-origin ownership refusal/release; clearing pending UI state on Stop/replacement and no auto-play after reload; desktop/mobile layout and no page script errors. The live test's mute assertion checks the indicator, and its cancellation assertion checks UI state. Native future-source silence is proved separately by the offline render; neither is a physical-output measurement.

The integrator and independent UI reviewer inspected the macOS desktop, mobile and crossfade screenshots. No obvious clipping, overlap or misleading state was found. That is a bounded visual review, not comprehensive accessibility or device qualification. [Desktop](../evidence/emf-s02/player-ready.png) and [mobile](../evidence/emf-s02/player-mobile.png) captures are retained with the raw JSON evidence.

## Review, failures and corrections

The [independent source review](../reviews/EMF_S02_PLAYER_REVIEW.md) retained the narrow one-clock design and recorded its original source pin and pending evidence honestly. Its correction/addendum history remains intact.

| Finding or limitation encountered | Resolution / evidence |
| --- | --- |
| Failed no-voice Resume could retain the UI ownership lease. | Error cleanup now releases the unused lease; Stop is available while ownership exists. A separate reviewer reproduced the corrected path using the compiled app with DOM/lock/context doubles. |
| A rejected ownership promise during Resume could leave retained voices' clock advancing silently. | The rejection path gates output and awaits context suspension. The new regression checks rejection, paused/suspended state, zero output gain, frozen position after attempted advancement and no duplicate start; all ten player tests pass. |
| First hosted Linux run failed a strict 44.1 kHz natural-end assertion. | [Historical run 41902273454](https://github.com/splatter85/EUTONOS-Music/actions/runs/41902273454), source `dddb3c587ba32824f28c054411d80a46747b49d9`, passed decoding and the 48 kHz render. The check now reports the loader's already-allowed one-frame native EOF rounding while retaining exact cue boundaries and the original sample-error tolerance. The corrected run passes on all three OSes. |
| Windows test teardown attempted to remove a child process's working directory before stopping it. | Cleanup now kills/awaits the child before removing its directory, and closes in-process servers before removing fixtures. A Node hook-order probe reproduced the cleanup hazard; the corrected Windows job completes all 54 tests. Jobs now have a ten-minute upper bound. |
| Workspace-native browser execution was unavailable. | The cloud browser could not reach executor loopback, file URLs were disallowed, and the managed local Chromium launch lacked its required Unix-socket capability. No sandbox/access restriction was changed. Native execution evidence comes from the named hosted runners. |

These findings are scoped to this implementation and test harness. The source review was not an independent human audition or a full security/browser audit. No known blocking defect remains for the assigned S02 engineering gate.

## Decisions and remaining limits

The selected renderer is native Web Audio buffer sources plus gain automation. Pause suspends the single audio clock while retaining ownership; Stop and replacement release sources and invalidate generation. Late transitions fail visibly instead of inventing an unapproved cue or loop. Device/context uncertainty defaults to stopped or paused recovery requiring explicit user input.

**Audio was rendered natively in a browser. Live browser transport and clock behavior were exercised. Physical speaker/headphone output was NOT TESTED. Human listening and musical acceptance were NOT TESTED.** The original synthetic recordings remain `fixture-only`, with their existing reproducible generator, source hashes and [provenance](../../fixtures/s01/README.md). Passing engineering checks does not promote them to reviewed music.

Safari, Firefox, mobile devices, actual device loss/OS sleep, long background sessions, latency, long-duration resource behavior and listening preference remain unqualified. Hidden-page pause and interruption policy are implemented but the hosted suite does not qualify every real lifecycle event. A Web Lock coordinates cooperating tabs in one origin/storage partition; it does not own the OS audio device or coordinate different profiles, browsers, ports or machines. No full DJ, live procedural output, actual FL Studio/MCP operation or Mission Control integration is claimed.

## Publication and last verified checkpoint

The implementation and corrections were published on the review branch at the tested source SHA above. Git fetch/readback confirmed the remote source tree exactly matched the local tree before CI. The successful run and downloaded artifact ZIP digests identify the observed native evidence; compact reports and inspected screenshots are retained in this repository so CI artifact expiry does not erase the findings.

The bounded documentation review checked nine changed/new Markdown documents: all 75 local links and five referenced heading anchors resolve, all 19 document IDs remain unique, and no draft placeholders remain. The prior Progress content is preserved byte-for-byte as the historical prefix; the S02 progress record is appended. `git diff --check` passes.

This closeout adds documentation/evidence only to that tested source: no runtime, tests, media, package lock or workflow changes. Publication targets `main` with a checked expected prior SHA, preserving unrelated work. The containing closeout commit cannot name itself; its exact SHA and completed remote `main`/handoff readback are supplied in the mini chat handoff. Inspect current main on the next pickup; this file is an as-of record, while the campaign owns current status.

## Next handoff

**One primary next slice: EMF-S03 — CLOUD.** Prerequisites are the published S02 player, unchanged S01 pack and typed control contract, and Node 24.x. First inspect current `main` and working changes, preserve unrelated work, read AGENTS, Current Tasks, Work Model, the campaign and this handoff, then run `npm ci --ignore-scripts` and `npm run check`. Implement the thin deterministic DJ state/genre/Next/queue/Hold behavior with explicit queue priority, cancellation, idempotent retries and no-match fallback. S03 must connect the existing control seam to this player; it has not been implemented here.

**Owner PC action:** S08 FL Studio/MCP may proceed independently using the unchanged S01 pack contract. No PC action is required to unblock cloud S03. The later S09 join and S10 owner listening gate still precede S12 Mission Control.

The campaign remains **IN_PROGRESS**. S02 closes its bounded cloud engineering scope; EMF03's real-device qualification and the full standalone MVP remain open. The slice sequence is unchanged, overall effort percentage is **unknown**, and preparing the S03 pickup does not execute that slice or authorize PC side effects.
