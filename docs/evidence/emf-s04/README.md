# S04 engineering evidence

S04 is published on `work/emf-s04-procedural-20261104`; the owner explicitly instructed that main remain unchanged. The [handoff](../../handoffs/EMF-S04-HANDOFF.md) owns the actual slice disposition and source applicability. The records below retain original failures and corrections separately.

## Source and local checks

| Checkpoint | Source applicability | Evidence |
| --- | --- | --- |
| Initial local implementation | `d921382ba948b5bad370751c90b39fb695888058`, tree `a28ff92757aa7c03f479ef4f5921290cfb148008`; published as `d2ae7e9e8c6a56ead6b28b4e249c5f2b99128abf` with identical tree | [local-check.log](local-check.log): 127 Node tests pass; seven fixture files byte-identical; six WAVs validated |
| Original blocked closeout | Local `c5f1637574c76ff01625e38ecb34fadd7f840e45`, tree `d7cf5bbcf5b6efddcf7f771e50dc44a0f9c274cd`; later published as `9f89e1ed9459260c228f8ed4cc22bed089bb55b6` with identical tree | Documentation/evidence only relative to the initial implementation |
| Replay diagnostics | Published `9e087fa8a140048e014ad7d4d215a9ac68e0856c`, tree `4bc5fec77a73bcc77b02eb0191aa5eed71f3dbd0` | Strict replay assertion retained; measured failure details below |
| Fixed-pair source | Local `f4c804075db713918ddf7a09a3a4f622b7e930c1`, published `73c456a147dcf24161ce22187e5e62320c5141b5`, identical tree `92362e7d5dd6552c0255ae0e9220115d104fe052` | [fixed-local-check.log](fixed-local-check.log): 130 Node tests pass; unchanged fixture/media checks |

Both local checks used Linux, Node 24.22.1, npm 11.9.0 and TypeScript 5.9.3. Setup was `npm ci --ignore-scripts`; the recorded command was `npm run check`. The logs were captured from the corresponding implementation working trees before their local commits. Different publication metadata gives different commit hashes; exact source trees were compared instead of falsely relabelling local hashes as GitHub commits.

Node scheduling/transport tests use context/source doubles and do not render PCM. An npm environment-config warning did not fail the checks. Timing values are observations from those runtimes, not performance guarantees. Subsequent closeout changes only documentation/evidence; any later runtime change needs its own applicability statement.

## Initial native replay failure

[Run 41959790896](https://github.com/splatter85/EUTONOS-Music/actions/runs/41959790896), at published checkpoint `9f89e1e…`, passed 127 Node tests and fixture/media checks on Windows, macOS and Linux. Native checks passed 13 of 15 groups on each OS. The only failures were strict same-seed replay at 48 and 44.1 kHz. Independent sums, lifecycle behavior and all nine original recording checks passed; the UI flow did not run because the native gate failed. A representative original [macOS offline report](initial-native-failure/macos/offline.json) is retained at its original source.

## Diagnostic run and measured differences

[Run 41960453351](https://github.com/splatter85/EUTONOS-Music/actions/runs/41960453351), at `9e087fa8…`, kept exact replay equality and the original maximum absolute oracle-error tolerance `0.000003`. It found identical plans and bitwise-identical decoded samples. Every output difference had three or four nonzero contributors; there were zero differences outside overlap or with fewer than three contributors.

| OS | Rate | Different output samples | Maximum absolute replay delta | Raw report |
| --- | ---: | ---: | ---: | --- |
| Linux | 48,000 Hz | 20,910 | `2.9802322387695312e-8` | [offline.json](replay-diagnostics/linux/offline.json) |
| Linux | 44,100 Hz | 12,599 | `1.4901161193847656e-8` | Same report |
| macOS | 48,000 Hz | 18,875 | `1.4901161193847656e-8` | [offline.json](replay-diagnostics/macos/offline.json) |
| macOS | 44,100 Hz | 16,956 | `1.4901161193847656e-8` | Same report |
| Windows | 48,000 Hz | 20,010 | `1.4901161193847656e-8` | [offline.json](replay-diagnostics/windows/offline.json) |
| Windows | 44,100 Hz | 14,702 | `1.4901161193847656e-8` | Same report |

Each diagnostic directory also retains its original `failure.json`. Artifact ZIP SHA-256 digests were checked against GitHub metadata before extracting the reports. These failures support correcting fixed summation grouping; they are not relabelled as passing runs. The source correction and independent review are documented in the [review](../../reviews/EMF_S04_PROCEDURAL_REVIEW.md).

## Corrected native/browser gate — PASS

[Run 41961109555](https://github.com/splatter85/EUTONOS-Music/actions/runs/41961109555) completed successfully at exact published source **`73c456a147dcf24161ce22187e5e62320c5141b5`**. Every platform passed **130 Node tests, seven deterministic fixture files, six WAV validations, 15 native audio groups and 11 browser report groups**. The latter comprises one native summary plus ten UI groups. Nine native groups preserve the recording checks; six exercise the sampler.

| OS | Job | Node | Native report | Browser report |
| --- | --- | --- | --- | --- |
| Linux | `127027428387` | 24.22.1 | [offline.json](final/linux/offline.json) | [browser.json](final/linux/browser.json) |
| macOS | `127027428208` | 24.22.2 | [offline.json](final/macos/offline.json) | [browser.json](final/macos/browser.json) |
| Windows | `127027428061` | 24.22.2 | [offline.json](final/windows/offline.json) | [browser.json](final/windows/browser.json) |

All used Chromium **151.0.7922.34** and Playwright **1.62.1**. Browser runner durations were 20,041 ms (Linux), 21,600 ms (macOS) and 19,418 ms (Windows); these are run observations, not performance guarantees. The corresponding artifact ZIP digest was checked before every extraction:

| OS | Artifact ID | ZIP bytes | ZIP SHA-256 |
| --- | --- | ---: | --- |
| Linux | `13385252565` | 865,094 | `830a08c29cebfeb11e89d87d1230da38d7e40f79a31d71b93759d94c50ff29af` |
| macOS | `13385631699` | 868,228 | `3385ccf5dbe498defaee26a3a4ce0498af91f87922ee75c236759ebae96d970e` |
| Windows | `13384968281` | 532,207 | `e5479e33e73d576344033ab8fb84eb8c699d36d0d22f1ee7fabc04bdea4cd77b` |

[Provenance and extracted-file hashes](final/provenance.json) pin the run, source, jobs, artifact IDs/digests and retained files. All nine files per final artifact are preserved, independent of GitHub artifact expiry. The evidence closeout does not change runtime, tests, assets, packages or workflow.

### Native measurements

Each OS independently reports exact symbolic plans, bitwise-identical decoded samples and **bitwise-identical same-seed rendered output** at both rates: zero differing samples, zero differing bit patterns and zero maximum absolute replay delta. Each replay pair compares **792,000 samples at 48 kHz** or **727,650 at 44.1 kHz**. This is repeatability within each tested browser/OS/rate, not a promise of identical bytes between platforms.

All three OSes report seed 2 changing **350,400 / 321,900** output samples and held-out seed `0xdeadbeef` changing **136,800 / 125,666**, at 48 / 44.1 kHz respectively. This demonstrates the tested variations, not uniqueness of every seed or musical quality.

The independent sample oracle covers **16 S04 renders per OS**, eight at each rate: natural playback, replay, both seed variations, Stop, exit fade, cancellation and released-source silence. The original maximum absolute tolerance is unchanged at **`3e-6`**.

| OS | Rate | Maximum S04 oracle error | Maximum S04 peak |
| --- | ---: | ---: | ---: |
| Linux | 48,000 Hz | `1.598351953291388e-7` | `0.24441172182559967` |
| Linux | 44,100 Hz | `7.77475687996354e-8` | `0.24409909546375275` |
| macOS | 48,000 Hz | `2.785218028433789e-8` | `0.24441173672676086` |
| macOS | 44,100 Hz | `2.4038826942907043e-8` | `0.24409909546375275` |
| Windows | 48,000 Hz | `1.598351953291388e-7` | `0.24441172182559967` |
| Windows | 44,100 Hz | `7.77475687996354e-8` | `0.24409909546375275` |

The maximum error occurs in the 48 kHz exit-fade case on Linux/Windows. Head/tail silence checks pass; released-source cases have zero nonzero samples, zero peak and zero error. Exact source entry/natural-end frames are 12,000 / 780,000 at 48 kHz and 11,025 / 716,625 at 44.1 kHz, giving sixteen seconds after entry. Stop, phrase exit, future-exit cancellation and stale-generation release all pass.

Observed schedules contain 73, 77 or 87 note nodes, with `eventCount === allocatedNoteNodes`; measured simultaneous voices never exceed four. Decoded Float32 sample values are 81,600 at 48 kHz and 74,967 at 44.1 kHz (326,400 / 299,868 bytes). Every render allocates two mix buses and reports `releasedLiveNodes: 0` and `releasedMixBuses: 0`. These measurements and the code-enforced caps describe this bounded fixture, not total browser process memory or endurance.

For exact report locations, `results[9]` and `[12]` contain independent sums at 48/44.1 kHz; `[10]` and `[13]` contain replay/variation, including `evidence.diagnostics`; `[11]` and `[14]` contain lifecycle cases. All original nine recording groups also pass.

### Browser flow and visual inspection

The full S03 flow passes: stopped requests, FIFO reservations/cancellation, Hold, mute/resume, live A→B entry/queue consumption, unsupported targets, blocked queue handling, ownership conflict/transfer, reload and mobile fit. The sampler group passes initial silent selection, preview changes, invalid-seed refusal, play/pause with frozen clock/resume/mute/stop, replay metadata, shared recording-page ownership and mobile fit. These are actual hosted Chromium interactions at the pinned source.

| Inspected views | Linux | macOS | Windows |
| --- | --- | --- | --- |
| Sampler desktop | [sampler-ready.png](final/linux/sampler-ready.png) | [sampler-ready.png](final/macos/sampler-ready.png) | [sampler-ready.png](final/windows/sampler-ready.png) |
| Sampler mobile | [sampler-mobile.png](final/linux/sampler-mobile.png) | [sampler-mobile.png](final/macos/sampler-mobile.png) | [sampler-mobile.png](final/windows/sampler-mobile.png) |

The integrator visually inspected Linux sampler desktop/mobile and recording [crossfade](final/linux/player-crossfade.png)/[mobile](final/linux/player-mobile.png); the independent reviewer inspected macOS/Windows sampler desktop/mobile. Selected variation remains distinct from Nothing playing, metadata and controls are legible, mobile text/controls fit, and no material clipping or overlap was observed. Font/wrapping differences are visible between hosts. The mobile Play background is consistent with a screenshot during the 120 ms color transition after Stop/resize; this does not demonstrate disabled playback. No claim is made that every retained image received separate visual review. The other recording screenshots are preserved with their automation reports.

**Physical speaker/headphone output and human listening remain NOT TESTED.** Headless native rendering and UI execution do not establish musical preference, real-device behavior, long-session reliability or the full standalone MVP. Prior S03/S08 evidence retains its original applicability. The source accepts other native rates but this evidence qualifies only 44.1/48 kHz in the named Chromium runs.
