# S02 retained execution evidence

Source: [`c7f75321bf034517fd0b2fde41298285b89f26b9`](https://github.com/splatter85/EUTONOS-Music/commit/c7f75321bf034517fd0b2fde41298285b89f26b9), tree `433493c05ee4d04fa5705cd82a094ff2dc5204c9`.

[Run 41903543079](https://github.com/splatter85/EUTONOS-Music/actions/runs/41903543079) completed successfully on 2026-11-04. These files were copied unchanged from its downloaded artifacts after checking each ZIP against GitHub’s published SHA-256 digest. The final documentation/evidence closeout does not change this tested runtime, tests, fixtures, dependencies or workflow.

| Platform | Raw browser report | Raw offline report | Original artifact |
| --- | --- | --- | --- |
| Linux | [linux-browser.json](linux-browser.json) | [linux-offline.json](linux-offline.json) | [13360500024](https://github.com/splatter85/EUTONOS-Music/actions/runs/41903543079/artifacts/13360500024) |
| Windows | [windows-browser.json](windows-browser.json) | [windows-offline.json](windows-offline.json) | [13360011467](https://github.com/splatter85/EUTONOS-Music/actions/runs/41903543079/artifacts/13360011467) |
| macOS | [macos-browser.json](macos-browser.json) | [macos-offline.json](macos-offline.json) | [13358159071](https://github.com/splatter85/EUTONOS-Music/actions/runs/41903543079/artifacts/13358159071) |

The original `offlineReport: "offline.json"` value inside each browser report is preserved; use the corresponding platform pair above. [provenance.json](provenance.json) records source/run/runner identities, original artifact digests and hashes of retained report/screenshot files. Full CI logs remain at the linked jobs. Runner image facts come from logs; browser user-agent compatibility strings are not treated as exact OS identities.

## Observed checks

| Runner / OS | Node / npm | `npm run check` | Native browser checks |
| --- | --- | --- | --- |
| [Ubuntu 26.04.1 LTS](https://github.com/splatter85/EUTONOS-Music/actions/runs/41903543079/job/126832006821) (`ubuntu-26.04`) | v24.22.1 / 11.19.1 | 54/54; fixture/media PASS | 7 offline checks and live browser groups PASS |
| [Microsoft Windows Server 2025 10.0.26100 Datacenter](https://github.com/splatter85/EUTONOS-Music/actions/runs/41903543079/job/126832007193) (`windows-2025-vs2026`) | v24.22.2 / 11.19.1 | 54/54; fixture/media PASS | 7 offline checks and live browser groups PASS |
| [macOS 26.6.2](https://github.com/splatter85/EUTONOS-Music/actions/runs/41903543079/job/126832006128) (`macos-26-arm64`) | v24.22.1 / 11.19.1 | 54/54; fixture/media PASS | 7 offline checks and live browser groups PASS |

| Platform | Maximum sample error, 48 kHz | Maximum sample error, 44.1 kHz | Peak, 44.1 kHz | Natural EOF delta, 48 / 44.1 kHz |
| --- | --- | --- | --- | --- |
| Linux | 3.27062007e-07 | 3.30006826e-07 | 0.456904709 | 0 / −1 frame |
| Windows | 3.27062007e-07 | 3.30006826e-07 | 0.456904709 | 0 / −1 frame |
| macOS | 3.8311584e-08 | 3.67730923e-08 | 0.45690468 | 0 / −1 frame |

The browser runner has five result groups: the first summarizes the seven native offline checks; four more cover live transport/Now/Next, ownership, replacement/reload and layout/script errors. It is not twelve independent live audio measurements. Offline sample comparison tolerance is `0.000003`; exact event frames and the one-frame 44.1 kHz natural-EOF difference are recorded separately.

## Inspected screenshots

[Desktop ready](player-ready.png) and [mobile ready](player-mobile.png) are original captures from the successful macOS job. The integrator and a separate UI reviewer found no obvious clipping or overlapping controls. The reviewer also inspected the original crossfade screenshot in the artifact and found its Now/Next state consistent. This is a bounded visual check, not a full accessibility audit.

**Physical speaker/headphone output and human listening: NOT TESTED.** Native offline rendering and a headless live context do not establish perceived sound, device latency, musical approval, Safari/Firefox compatibility, mobile-device behavior, or full standalone-MVP acceptance. See the [detailed handoff](../../handoffs/EMF-S02-HANDOFF.md) for source review, corrected failures, limits and the S03 pickup.
