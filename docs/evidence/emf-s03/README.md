# S03 retained execution evidence

Tested source: [`71d954534087ff1637b8ff0e8fc51c393a89abfa`](https://github.com/splatter85/EUTONOS-Music/commit/71d954534087ff1637b8ff0e8fc51c393a89abfa), tree `2eba5fc6ccfb4b3f475ef92512a37436656f1623`.

[Run 41925003036](https://github.com/splatter85/EUTONOS-Music/actions/runs/41925003036) completed successfully on **all three platforms** on 2026-11-04. These reports/screenshots were copied unchanged from its artifact ZIPs after comparing each ZIP with GitHub's published SHA-256 digest. The final closeout adds documentation/evidence only to this tested runtime, tests, workflow, dependency lock and fixtures.

| Platform | Raw browser report | Raw offline report | Original artifact |
| --- | --- | --- | --- |
| Linux | [linux-browser.json](linux-browser.json) | [linux-offline.json](linux-offline.json) | [13368447130](https://github.com/splatter85/EUTONOS-Music/actions/runs/41925003036/artifacts/13368447130) |
| Windows | [windows-browser.json](windows-browser.json) | [windows-offline.json](windows-offline.json) | [13367439886](https://github.com/splatter85/EUTONOS-Music/actions/runs/41925003036/artifacts/13367439886) |
| macOS | [macos-browser.json](macos-browser.json) | [macos-offline.json](macos-offline.json) | [13368596881](https://github.com/splatter85/EUTONOS-Music/actions/runs/41925003036/artifacts/13368596881) |

The reports' original `offlineReport: "offline.json"` value is preserved; use the corresponding platform pair above. [provenance.json](provenance.json) records the exact source/run, OS/image and job versions, original artifact digests and retained-file hashes. Full CI logs remain in the linked jobs. User-agent compatibility strings are not treated as exact OS identities.

## Observed execution

| Runner / OS | Node / npm | `npm run check` | Native browser result |
| --- | --- | --- | --- |
| [Ubuntu 26.04.1 LTS](https://github.com/splatter85/EUTONOS-Music/actions/runs/41925003036/job/126906961905), `ubuntu-26.04` | 24.22.1 / 11.19.1 | 101/101, zero skipped; fixture/media PASS | 9 offline checks and all 10 report groups PASS |
| [Windows Server 2025 10.0.26100 Datacenter](https://github.com/splatter85/EUTONOS-Music/actions/runs/41925003036/job/126906962429), `windows-2025-vs2026` | 24.22.2 / 11.19.1 | 101/101, zero skipped; fixture/media PASS | 9 offline checks and all 10 report groups PASS |
| [macOS 26.6.2](https://github.com/splatter85/EUTONOS-Music/actions/runs/41925003036/job/126906962548), `macos-26-arm64` | 24.22.1 / 11.19.1 | 101/101, zero skipped; fixture/media PASS | 9 offline checks and all 10 report groups PASS |

All three runs use **Playwright 1.62.1 / Chromium 151.0.7922.34**. Fixture regeneration checked seven exact files; the media validator checked six WAVs. The browser report's ten groups consist of one summary of the nine offline checks plus nine UI behavior groups; they are not ten distinct physical-audio measurements.

The live UI checks cover stopped requests with no auto-play, explicit initial FIFO selection, consumption at entry, paused scheduling/cancellation/rescheduling, Hold refusal and release, mute/Resume, one live A→B mix, unsupported targets, blocked FIFO ordering/recovery, ownership refusal/transfer, silent reload/fresh Play, mobile controls and no page errors.

## Native sample results

| Platform | A→B max sample error, 48 / 44.1 kHz | Cancellation restoration max error, 48 / 44.1 kHz | Natural EOF delta, 48 / 44.1 kHz |
| --- | --- | --- | --- |
| Linux | 3.27062007e-07 / 3.30006826e-07 | **0 / 0** | 0 / −1 frame |
| Windows | 3.27062007e-07 / 3.30006826e-07 | **0 / 0** | 0 / −1 frame |
| macOS | 3.8311584e-08 / 3.67730923e-08 | **0 / 0** | 0 / −1 frame |

The unchanged maximum absolute sample-error tolerance is **0.000003**. Existing A→B checks compare 1,176,000 samples at 48 kHz and 1,080,450 at 44.1 kHz. Exact B entry / scheduled A handoff frames are 396000 / 588000 and 363825 / 540225 respectively. The already-allowed one-frame 44.1 kHz natural EOF difference remains separate from the exact cue boundaries.

The two new cancellation checks suspend native rendering after A has emitted about two seconds, cancel future B, restore A's original gain/end, then resume. Every sample matches the expected full-length A: **792,000** compared at 48 kHz, **727,650** at 44.1 kHz, with a nonzero restored tail. Absolute restored A end frames are 780000 and 716624. Cancellation does not merely remove B while leaving A's old fade/early stop behind.

Other native checks retain explicit fixture eligibility, validated decoding of all six WAVs, all-zero cancelled future audio, stale-plan refusal and an exact pickup/nonzero-entry diagnostic.

## Inspected screenshots

- [Desktop ready](player-ready.png): initial silent state and available requests.
- [Mobile queue](player-mobile.png): stopped A queued, explicit Play still required, controls fit at 390 px.
- [Crossfade](player-crossfade.png): both sources under Now, no additional scheduled source, Cancel next disabled.
- [Blocked FIFO](player-blocked-queue.png): paused A, retained A→B queue order, visible reason that the head cannot take a checked route.

These are original captures from the successful macOS job. The integrator inspected desktop/mobile; a separate UI reviewer inspected mobile/crossfade/blocked FIFO and reported no material clipping, overlap or misleading state. This is a bounded visual review, not comprehensive accessibility or mobile-device qualification.

## Historical correction and limits

The preceding assembled [run 41924417277](https://github.com/splatter85/EUTONOS-Music/actions/runs/41924417277) at `18c676f8213f876f0db89d88d4a55ea7eb37c97a` failed a runner assertion because `innerText()` was empty inside a collapsed clock disclosure. The captured pause state and earlier `textContent` clock check were correct. Two reads now use `textContent()`; frozen-clock/suspension assertions and all audio tolerances remain intact. The successful run above checks the corrected source on every platform.

**Physical speaker/headphone output and human listening: NOT TESTED.** Native offline rendering and headless live-context behavior do not establish perceived sound, device latency, musical approval, Safari/Firefox compatibility, real mobile devices, OS sleep/device loss, endurance or full standalone-MVP acceptance. The original fixtures remain `fixture-only`. No S08 private audio was imported. See the [detailed S03 handoff](../../handoffs/EMF-S03-HANDOFF.md) for source review, recovery policy and the next S04 CLOUD pickup.
