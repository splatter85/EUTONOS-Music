# EMF-S04 procedural sampler review

**Campaign:** `campaign-emf-001`  
**Slice:** EMF-S04 — CLOUD  
**Date:** 2026-11-04, America/Chicago  
**Disposition:** **KEEP for the bounded source/transport scope after the corrections below. Published on the S04 work branch; corrected native/browser verification passes on Windows, macOS and Linux. Main is intentionally unchanged.**
**Initial local implementation pin:** `d921382ba948b5bad370751c90b39fb695888058`, tree `a28ff92757aa7c03f479ef4f5921290cfb148008`.

## Method and applicability

A separate reviewing agent inspected the shared source lifecycle, phrase plan, sampler, player integration and tests, then added only `tests/procedural-review.test.ts`. It did not implement the source fixes. The integrating agent applied corrections, read the final compiler and native harness, and ran the assembled 127-test check. Other agents authored the pure phrase compiler and native/browser checks; those parts are not represented as independently reviewed by their own authors. The review did not execute native audio or listen to a performance.

The working source reviewed and corrected was subsequently committed at the local pin above. The phrase compiler's final independent role streams and replay digests are covered by its ten-test suite and the integrating agent's final inspection. The separate review's six tests focus on player/source ownership, resource bounds and cleanup. This review is a scope-specific engineering assessment, not a full campaign or musical-quality gate.

## KEEP

- A finite, immutable plan pins the executable performer, seed/state, recipe, palette and sample metadata. Only plans compiled by the current module are admitted; replay recompiles exact versioned inputs.
- The source schedules all notes on the existing native context/clock before entry. It does not add a note scheduler based on UI timers or another audio clock.
- Playback and sample-reuse permissions are checked against bound and supplied metadata, with copied-byte size/hash validation before native decoding in the normal player path.
- Event, decoded-sample and actual interval-polyphony bounds are explicit. Partial graph/schedule failure remains gated and releases retained resources.
- Stop, generation invalidation, denied ownership and stale asynchronous completion cannot restart a cancelled performance or replace a newer recording.
- Pause during decode followed by Resume retains the selected seed/state and schedules one performance on the retained clock.
- The source keeps concrete future-exit cancellation separate from the common lifecycle. Audition replacement does not imply hybrid route support.

## CHANGE — corrected and rechecked

| Finding | Correction and evidence |
| --- | --- |
| Each rapid Play/Stop could start an independent four-sample decode, so per-source memory limits did not bound pending player preparation. | Share one pending/resolved decode promise with an exact sample-metadata binding. Four cancelled/replaced requests use only four sample decodes in the regression; subsequent requests reuse the result. Stop retains the bounded cache; disposal releases player references. |
| A cache could make repeated intents skip permission checks if reuse were treated as sufficient validation. | Revalidate the authentic plan, current pack and metadata/rights before every use. The reviewer test revokes eligibility after caching and verifies refusal. |
| Late ownership failure and pending decode can race with a newer recording or Pause/Resume. | Observe readiness failures immediately and gate stale work by the existing operation/generation rules. Independent delayed-gate and pause tests verify that current playback is preserved. |
| Fractional-second one-shot endpoint rounding could add a frame at 44.1 kHz and overlap a same-role note. | Convert the absolute authored endpoint from integer native-sample frames and bound it by the decoded buffer length. Call-recorder coverage passes at both rates; native comparison was initially unrun and subsequently passed in corrected run 41961109555. No tolerance was widened. |
| Recipe identity and generic lifecycle names could be mistaken for complete performance identity or S05 overlap semantics. | Document full-plan replay identity, replacement behavior, construction-time fade lengths, whole-performance fade/continued attacks and the concrete-only cancellation extension. |
| UI wording could label a symbolic selection as prepared audio or imply that every Play always decodes. | Use selected-variation/rhythm-plan wording and “Preparing playback…”; keep selected, scheduled and clock-active evidence separate. Browser execution was initially pending and subsequently passed in corrected run 41961109555. |

## Executed focused checks

After the integrator's successful build, the reviewer ran `node --test dist/tests/procedural-review.test.js dist/tests/player.test.js`: **six reviewer cases plus eleven existing player cases, 17 passed**. This independent invocation ran on the earlier working candidate before the final independent-role-stream and authored-end-rounding edits; it is not an independent execution at the final commit pin. The reviewer subsequently read the final source and its 127-test log, which includes the same six regressions. The six added cases cover:

1. One bounded decode across rapidly cancelled requests and cached replay.
2. Revoked sample permission after the palette is cached.
3. Late ownership rejection from an obsolete procedural request while a newer recording remains selected.
4. Pause during preparation, then Resume with the same seed and one note schedule.
5. Detached sample metadata and retained start stamps.
6. Graph allocation failure with complete cleanup before an audible gate can open.

These use context/source doubles and the real player/source logic. They prove deterministic state and native-call intent; they do not produce PCM. The final broader `npm run check` passed **127 tests**, unchanged deterministic fixture regeneration and all six media validations. [Retained local log](../evidence/emf-s04/local-check.log).

## Initial verification and publication limits (historical)

At the original local closeout, the six new native offline groups and added browser sampler group were implemented but **NOT RUN**. No S04 screenshot, native sample-error measurement or cross-platform CI result existed at that checkpoint. Local Chromium was blocked by a socket restriction, the connected-browser context was unavailable, and the cloud browser could not access the local server. Public Git publication was separately rejected by automatic approval review at that checkpoint; no alternate write route was used before the owner subsequently authorized a separate-branch publication.

S05 must address incoming overlap, phrase/role/bass/tail ownership and recorded → procedural → recorded routes. This review does not approve those absent policies. Broad recipe families, persistent replay history, arbitrary imported plans, other browsers/rates, physical output, long-session behavior and human listening remain open. The original fixtures retain their existing rights/review status; no private FL render was imported.

The [S04 handoff](../handoffs/EMF-S04-HANDOFF.md) owns the current disposition, recovery and next executable step. The campaign remains in progress; the subsequent branch-only authorization, native findings and correction are recorded below.


## Published native finding and paired-mix correction — 2026-11-04

The owner subsequently authorized publication on `work/emf-s04-procedural-20261104` and explicitly excluded main. Published source `d2ae7e9e8c6a56ead6b28b4e249c5f2b99128abf` matches the initial local source tree; published checkpoint `9f89e1ed9459260c228f8ed4cc22bed089bb55b6` matches the initial local documentation tree. The first hosted run passed all 127 Node tests and 13 of 15 native groups on all three OSes, but strict replay failed at both rates. The browser UI flow stopped at that gate.

Diagnostic revision `9e087fa8a140048e014ad7d4d215a9ac68e0856c` preserved exact replay equality and the existing `0.000003` independent-oracle tolerance. [Run 41960453351](https://github.com/splatter85/EUTONOS-Music/actions/runs/41960453351) found exact symbolic plans and bitwise-identical decoded samples on all three OSes. All output differences occurred with three or four nonzero contributors, with maximum delta at most `2.9802322387695312e-8`; none occurred outside overlap or with fewer than three contributors. This strongly supports a floating-point summation issue but does not prove a particular browser internal iteration mechanism. [Retained diagnostic reports](../evidence/emf-s04/README.md).

The correction groups drum/percussion and bass/harmony into two fixed unity-gain sums feeding the existing master. Actual rounded output-frame intervals enforce at most one active note per role, hence at most two active signals per pair. Both buses are registered immediately inside the existing gated scheduling transaction, before further native calls can fail. Partial failure, explicit release and last-note completion disconnect and clear them. This adds exactly two fixed GainNodes per scheduled source without changing sample bindings, note starts/deadlines, per-note gain, or master fade/stop/cancellation semantics.

The source/harness author made this correction and its two focused source-test additions. The independent reviewer then read the actual patch and changed only its own test file: the existing allocation-failure injection still targets the third note despite the fixed mixer nodes, and a new case fails the second bus's connection after allocation to check complete cleanup before any note starts. The reviewer independently ran `npm run build` and `node --test dist/tests/procedural-review.test.js dist/tests/player.test.js`: **18 passed, zero failed/skipped**, comprising seven reviewer and eleven existing player cases. It reported KEEP with no remaining material lifecycle issue.

The integrator's assembled `npm run check` passed **130 tests**, unchanged fixture regeneration and all six media validations. Corrected local commit `f4c804075db713918ddf7a09a3a4f622b7e930c1` and published source `73c456a147dcf24161ce22187e5e62320c5141b5` share exact tree `92362e7d5dd6552c0255ae0e9220115d104fe052`. The [corrected CI run](https://github.com/splatter85/EUTONOS-Music/actions/runs/41961109555) is the native/browser gate for that tree; its final observed outcome is recorded in the handoff and evidence index. Strict replay and the independent Float64 oracle tolerance remain unchanged. Physical output/listening and S05 musical routing remain outside this review.

## Final native/browser evidence

[Run 41961109555](https://github.com/splatter85/EUTONOS-Music/actions/runs/41961109555) completed successfully on **Windows, macOS and Linux** at corrected published source `73c456a147dcf24161ce22187e5e62320c5141b5`. Each OS passed **130 Node tests**, unchanged fixture/media checks, **15 native audio groups** and **11 browser report groups** (one native summary plus ten UI groups). All three retained reports show exact decoded PCM and same-seed output at both 48 kHz and 44.1 kHz: zero differing samples, zero differing bit patterns and zero maximum replay delta. The maximum measured independent-oracle error across the S04 renders is `1.598351953291388e-7`, below the unchanged `3e-6` tolerance. Each render allocated two mix buses and released all live note/mix nodes.

The reviewer visually inspected the macOS and Windows sampler desktop/mobile screenshots: seed/arrangement and Now/Selected Variation remain distinct and legible; transport/volume and footer controls fit the viewport with no observed clipping/overlap. The integrator inspected the corresponding Linux sampler views and Linux recording crossfade/mobile views. A mobile Play-button capture is consistent with its background-color transition; the automated transport assertions pass, and no disabled-playback failure was demonstrated. Screenshots are layout evidence, not listening or physical output proof. [Retained reports and screenshots](../evidence/emf-s04/README.md).

**Final bounded disposition: KEEP; S04 cloud engineering scope COMPLETE on the separate branch.** This documentation/evidence closeout does not alter the tested runtime. Main remains unchanged by owner instruction. S05 overlap/role transfer, physical output, human listening and full campaign acceptance remain outside this review.

A final independent read-only closeout review checked the handoff, evidence index, Current Tasks, campaign checkpoint, guide and this addendum against the retained native/browser reports and corrected local log. It found no material factual or recovery gap; historical failures, source pins, branch-only delivery and untested listening/device boundaries remain explicit. This documentation review did not rerun runtime tests.
