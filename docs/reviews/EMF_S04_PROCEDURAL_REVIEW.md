# EMF-S04 procedural sampler review

**Campaign:** `campaign-emf-001`  
**Slice:** EMF-S04 — CLOUD  
**Date:** 2026-11-04, America/Chicago  
**Disposition:** **KEEP for the bounded source/transport scope after the corrections below. Native rendering, browser execution, publication and integration are still pending.**  
**Final local implementation pin:** `d921382ba948b5bad370751c90b39fb695888058`, tree `a28ff92757aa7c03f479ef4f5921290cfb148008`.

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
| Fractional-second one-shot endpoint rounding could add a frame at 44.1 kHz and overlap a same-role note. | Convert the absolute authored endpoint from integer native-sample frames and bound it by the decoded buffer length. Call-recorder coverage passes at both rates; native comparison is written but unrun. No tolerance was widened. |
| Recipe identity and generic lifecycle names could be mistaken for complete performance identity or S05 overlap semantics. | Document full-plan replay identity, replacement behavior, construction-time fade lengths, whole-performance fade/continued attacks and the concrete-only cancellation extension. |
| UI wording could label a symbolic selection as prepared audio or imply that every Play always decodes. | Use selected-variation/rhythm-plan wording and “Preparing playback…”; keep selected, scheduled and clock-active evidence separate. Browser execution is still pending. |

## Executed focused checks

After the integrator's successful build, the reviewer ran `node --test dist/tests/procedural-review.test.js dist/tests/player.test.js`: **six reviewer cases plus eleven existing player cases, 17 passed**. This independent invocation ran on the earlier working candidate before the final independent-role-stream and authored-end-rounding edits; it is not an independent execution at the final commit pin. The reviewer subsequently read the final source and its 127-test log, which includes the same six regressions. The six added cases cover:

1. One bounded decode across rapidly cancelled requests and cached replay.
2. Revoked sample permission after the palette is cached.
3. Late ownership rejection from an obsolete procedural request while a newer recording remains selected.
4. Pause during preparation, then Resume with the same seed and one note schedule.
5. Detached sample metadata and retained start stamps.
6. Graph allocation failure with complete cleanup before an audible gate can open.

These use context/source doubles and the real player/source logic. They prove deterministic state and native-call intent; they do not produce PCM. The final broader `npm run check` passed **127 tests**, unchanged deterministic fixture regeneration and all six media validations. [Retained local log](../evidence/emf-s04/local-check.log).

## DEFER and delivery limits

The six new native offline groups and added browser sampler group are implemented but **NOT RUN**. No S04 screenshot, native sample-error measurement or cross-platform CI result exists. Local Chromium was blocked by a socket restriction, the connected-browser context was unavailable, and the cloud browser could not access the local server. Public Git publication was separately rejected by automatic approval review and requires explicit owner authorization; no alternate write route was used.

S05 must address incoming overlap, phrase/role/bass/tail ownership and recorded → procedural → recorded routes. This review does not approve those absent policies. Broad recipe families, persistent replay history, arbitrary imported plans, other browsers/rates, physical output, long-session behavior and human listening remain open. The original fixtures retain their existing rights/review status; no private FL render was imported.

The [S04 handoff](../handoffs/EMF-S04-HANDOFF.md) owns the exact block, recovery and next executable step. The campaign remains in progress, with S04 blocked at native verification/publication rather than complete.
