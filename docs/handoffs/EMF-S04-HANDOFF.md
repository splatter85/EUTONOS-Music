# EMF-S04 — original-palette procedural source handoff

**Campaign:** EMF / `campaign-emf-001`

**Slice / environment:** EMF-S04 — CLOUD

**Disposition:** **COMPLETE for the assigned cloud engineering scope on the separate S04 branch. Main remains unchanged by owner instruction. Physical output and human listening are NOT TESTED.**

**Recorded:** 2026-11-04, America/Chicago

**Inspected base and unchanged main:** `66e974c9abbebc6ea9e3aaa6bf55dbd053d8a5bb`, tree `0bad48392217372af9a491b699f908bc6fd86b13`.

**Published branch:** [`work/emf-s04-procedural-20261104`](https://github.com/splatter85/EUTONOS-Music/tree/work/emf-s04-procedural-20261104)

**Verified runtime/test source:** `73c456a147dcf24161ce22187e5e62320c5141b5`, tree `92362e7d5dd6552c0255ae0e9220115d104fe052`. Local tested commit `f4c804075db713918ddf7a09a3a4f622b7e930c1` has the identical tree. Different publication metadata gives different commit hashes.

**Native/browser verification:** [GitHub Actions run 41961109555](https://github.com/splatter85/EUTONOS-Music/actions/runs/41961109555), completed successfully on Windows, macOS and Linux at that exact published source. The containing closeout commit adds documentation/evidence only; its SHA is reported in the completing chat after publication and readback because this file cannot contain its own commit hash.

The [campaign checkpoint](../campaigns/EMF_INITIAL_INFRASTRUCTURE.md#current-checkpoint) owns status. [Retained evidence](../evidence/emf-s04/README.md) includes passing reports, screenshots and the earlier failed runs with their original source applicability. Main integration is outside this delivery and is not a blocker to branch completion.

## Assignment and inspected predecessor

The owner selected S04 after the completed [S03 handoff](EMF-S03-HANDOFF.md): implement the original-palette sampler/phrase source on the common clock and `prepare/start/exit/release` lifecycle, with bounded resources and reproducible seeded variation. The worker inspected clean main at the supplied S03-containing commit, read the repository instructions/contracts and ran Node 24 setup and the 101-test predecessor baseline.

The delivered scope is one finite performer and a source audition path. S05 owns recording A → procedural → recording B and its musical handoff policy. The two-recording DJ, one directed A→B route, original media and FL authoring facade retain their boundaries. S08's green Windows CI is predecessor evidence, not S04 validation. No DAW or Mission Control operation was performed. No PC pull or owner-side work is required to complete this cloud slice.

## Delivered behavior

| Area | Actual result |
| --- | --- |
| Phrase compiler | `src/phrase-plan.ts` compiles an immutable, versioned eight-bar performer from an explicit uint32 seed (including zero) and Explore/Drive arrangement. Independent deterministic role streams, four-bar statement/answer, bounded role choices, fills and cadence rests produce tested variation. |
| Native sampler | `src/procedural-source.ts` verifies/decodes four original samples and schedules finite notes on the existing clock, with declared phrase exits, entry/exit fades, Stop, pre-onset exit cancellation and idempotent release. |
| Player integration | `SmallPlayer.playProcedural()` uses the existing context, master output, clock, transport and ownership. One pending/resolved palette decode is shared across cancelled/replaced requests; every intent rechecks metadata and rights. |
| Audition page | `web/procedural.html` supplies seed/state selection, Play, Pause/Resume, Stop, Volume/Mute, separate selected and clock-active diagnostics, hidden-page pause and the cooperating-tab lock. Its desktop/mobile flows passed on all three OSes. |
| Verification | Ten compiler tests, sampler/player/reviewer regressions, six new native groups and a sampler browser group extend the retained S03 checks. The final suite passes 130 Node tests, 15 native groups and 11 browser report groups on each OS. |

There are no new runtime dependencies or sample recordings. The original six WAVs, manifest, generator and provenance are unchanged. Identities remain **s01-foundation@1**, **s01-recipe@1**, **s01-palette@1** and **s04-s01-performer@1**. Fixture playback is explicitly opted in and both playback and sample-reuse permissions are required. [S01 provenance](../../fixtures/s01/PROVENANCE.md) remains authoritative; no private FL render, proprietary asset or credential was added.

### Clock, identity and resource boundaries

Each performance is finite: eight bars / sixteen seconds, 4/4, 120 BPM, constant A minor and unchanged sample pitch. Seed/state selects rhythm and arrangement; it does not promise a unique song for every possible seed. The source reference names the recipe revision. Full replay identity also includes the performer version, pack/palette/sample bindings, seed and state. Only authentic plans compiled by the current module are accepted; replay recompiles those exact versioned inputs rather than accepting arbitrary or rehydrated event JSON.

All notes are scheduled before entry on the recording player's `WebAudioClock`. Timers and UI refreshes do not start notes. The master remains muted until the complete finite schedule has been allocated and validated; partial failures clean up before opening the gate. Code-enforced ceilings are **256 note sources**, **four simultaneous sounding intervals including tails**, and **1,048,576 Float32 sample values / 4 MiB** across the four decoded samples. These are allocation bounds, not measured browser process memory or endurance qualification.

Two fixed unity-gain buses pair drum/percussion and bass/harmony before the existing master. Rounded native-frame intervals enforce at most one active note per role, so each pair has at most two active signals. Both buses are registered inside the gated scheduling transaction and are released on allocation/connection failure, explicit release and last-note completion. `liveMixBuses` is zero before scheduling, two while scheduled and zero after cleanup. Note/sample ceilings are unchanged.

The only entry is quarter zero. Declared exits are `phrase` at quarter 16 / eight seconds and `end` at quarter 32 / sixteen seconds. Fade lengths are construction-time output-frame options; a nonzero fade beyond natural end is refused. The concrete source's `cancelTransition()` can cancel a future exit before onset; it is not part of the common lifecycle. Stale generation does not prevent release from cancelling future notes.

`playProcedural()` replaces current playback; it does not schedule a hybrid overlap. `transitionOut()` fades the whole precommitted performance, including later attacks during the fade. Tails-only release and separate bass/role ownership belong to S05. Stop retains one verified palette cache for replay; disposal drops player references. Every new intent checks current metadata/permissions, and a changed binding requires reload. Browser memory reclamation is not asserted.

## Executed verification

| Check | Actual result and applicability |
| --- | --- |
| Setup and predecessor | `npm ci --ignore-scripts`, then `npm run check` at main `66e974c…`: 101 Node tests, seven deterministic fixture files and six WAV validations passed. |
| Corrected local source | `npm run check`: **130 passed, zero failed/skipped**, TypeScript build, seven byte-identical regenerated fixture files and six media validations. Linux Node 24.22.1, npm 11.9.0, TypeScript 5.9.3. [Raw log](../evidence/emf-s04/fixed-local-check.log). |
| Phrase bounds/replay | Ten tests include pinned event digests, 12 selected and 12 designated held-out seeds plus 256 further seeds across both states: **560 seed/state combinations** in the bounds sweep. Tested sets vary in timing/structure; no universal listening claim. |
| Independent corrected review | Reviewer independently built and ran seven reviewer regressions plus eleven existing player cases: **18 passed, zero failed/skipped**. Allocation/connection failure, shared decode, stale operations, permission changes, ownership and Pause/Resume are covered. [Review](../reviews/EMF_S04_PROCEDURAL_REVIEW.md). |
| Windows CI | **130 Node tests, 15 native groups and 11 browser report groups passed**; Node 24.22.2, Chromium 151.0.7922.34, Playwright 1.62.1. Job `127027428061`. |
| macOS CI | **130 Node tests, 15 native groups and 11 browser report groups passed**; Node 24.22.2, same Chromium/Playwright. Job `127027428208`. |
| Linux CI | **130 Node tests, 15 native groups and 11 browser report groups passed**; Node 24.22.1, same Chromium/Playwright. Job `127027428387`. |
| Exact native replay | Same-seed decoded PCM and rendered output are bitwise identical within each tested OS/rate. **Zero differing samples, zero differing bit patterns and zero maximum replay error** at both 48 kHz and 44.1 kHz. |
| Native sample/lifecycle oracle | Independent Float64 sample sums, variation, finite boundaries, resource cleanup, entry/exit fades, Stop, cancellation and stale release pass at both rates. Original maximum absolute error tolerance **0.000003** is unchanged. |
| UI and screenshots | Full retained S03 flow plus sampler selection/invalid seed/play/pause/resume/mute/stop/replay metadata/shared ownership/mobile fit passed. Eleven report groups comprise one native summary plus ten UI groups. Reports and seven screenshots per OS are retained; inspected views and limits are recorded in the evidence index. |
| Physical output / human listening | **NOT TESTED.** No speaker/headphone qualification or musical acceptance is claimed. |

Exact replay compares **792,000 output samples at 48 kHz** and **727,650 at 44.1 kHz** per replay pair. Seed 2 changes 350,400 / 321,900 samples and held-out seed `0xdeadbeef` changes 136,800 / 125,666 samples, respectively, on all three OSes. This verifies the measured runs and deterministic identity, not identical audio bytes across browsers/OSes or uniqueness of every seed. Native context rates from 8–192 kHz are accepted by source validation, but only 44.1/48 kHz are natively qualified here.

Node doubles prove state and native-call intent; hosted OfflineAudioContext checks supply actual native PCM measurements; browser automation supplies UI/ownership evidence. None substitutes for device output, human listening, long-session reliability or full MVP acceptance. The campaign remains in progress with effort percentage unknown.

The documentation closeout check passed for **18 changed Markdown files and 241 relative links/anchors**. All 22 unique document IDs (including all 21 predecessor IDs), 20 campaign stages, 13 slices and 12 acceptance IDs are preserved. The 23,255-byte historical Progress prefix is unchanged, all 27 retained final artifact files match their recorded hashes, and `git diff --check` passes. Runtime/tests, fixtures, packages and workflow are unchanged from the corrected tested source. Original fixtures, authoring code/configuration and packages are also unchanged from intake main.

## Review findings and correction history

The independent initial review found that rapid replaced/cancelled Play could launch repeated decode chains. The integrator introduced one pending/resolved four-sample cache while preserving per-intent eligibility and generation checks. The reviewer initially ran 17 focused cases on an earlier candidate; the later 127-test integrator run included those regressions after final role-stream/end-rounding edits. This historical invocation is not relabelled as an independent final-source execution.

A source test also exposed a one-frame endpoint error at 44.1 kHz. Scheduling now converts the absolute authored endpoint from integer native-sample frames and bounds it by decoded length, avoiding an accidental same-role overlap. No native oracle tolerance was widened.

The first published run [41959790896](https://github.com/splatter85/EUTONOS-Music/actions/runs/41959790896), at `9f89e1ed9459260c228f8ed4cc22bed089bb55b6`, passed 127 Node tests and 13 of 15 native groups on all three OSes. Strict same-seed replay failed at both rates, so UI execution stopped. Diagnostic source `9e087fa8a140048e014ad7d4d215a9ac68e0856c` and [run 41960453351](https://github.com/splatter85/EUTONOS-Music/actions/runs/41960453351) preserved the gate. Plans and decoded samples were exact; all small output differences occurred with three/four simultaneous contributors, never outside overlap or with fewer than three contributors. This supports a floating-point summation issue but does not prove a particular Chromium internal iteration mechanism.

The two fixed buses described above make the supported summation grouping reproducible. The independent reviewer added a bus-connection-failure regression and passed 18 focused cases on the corrected candidate; the assembled suite increased to 130. Corrected run 41961109555 passes strict replay, the unchanged independent oracle and the full browser flow on all three OSes. [Raw failure, diagnostic and passing evidence](../evidence/emf-s04/README.md) retain separate source pins. The bounded engineering disposition is KEEP; S05 musical routing remains unimplemented.

## Publication history and recovery

The initial shell operation created local source `d921382ba948b5bad370751c90b39fb695888058`; automatic approval review then rejected public publication because that payload lacked explicit authorization. At that checkpoint, main remained `66e974c…` and no S04 branch existed. No alternate write route was used to bypass the rejection. The original local blocked closeout remains in repository history and Progress.

The owner then explicitly authorized pushing S04 to a separate branch and excluded main. Command-line Git lacked a login; the connected GitHub app published the authorized work. Published source `d2ae7e9e8c6a56ead6b28b4e249c5f2b99128abf` has the identical `a28ff92757aa7c03f479ef4f5921290cfb148008` tree to local `d921382…`; published checkpoint `9f89e1e…` has the identical `d7cf5bbcf5b6efddcf7f771e50dc44a0f9c274cd` tree to local closeout `c5f1637574c76ff01625e38ecb34fadd7f840e45`. Subsequent diagnostics and the corrected source were published only on this branch. Exact tree comparisons and readback preserve provenance across different commit metadata.

Local Chromium could not create its process-singleton socket; the connected browser lacked an originating context and a cloud-browser fallback could not reach loopback. These were local environment limitations, not successful checks. The actual required native/UI verification subsequently completed through the existing three-OS GitHub Actions route. No environment restriction was bypassed.

For recovery or the next assigned slice:

1. Inspect current main, branch/HEAD and working changes, preserving unrelated work. Fetch `work/emf-s04-procedural-20261104` and read this handoff and the campaign checkpoint at the published closeout revision.
2. Start from the checked S04 branch. Main intentionally lacks S04; **do not merge, reset or update main** as part of this delivery.
3. Use Node 24.x: `npm ci --ignore-scripts`, then `npm run check`. For native/browser verification use `npx playwright install --with-deps chromium` and `npm run check:browser` in a provisioned environment, or the existing three-OS CI workflow.
4. For optional audition, `npm run demo` serves http://127.0.0.1:4173/procedural.html. Select a seed/arrangement and explicitly Play. This is optional owner use, not an unfinished S04 gate.
5. Preserve historical reports at their source pins. A later runtime change requires new applicability evidence. Continue branch-only publication unless the owner gives a different instruction.

## One next actionable slice

**Next: EMF-S05 — CLOUD**, when separately assigned, from the verified S04 branch: recording A → procedural → different recording B with checked cues, bass/tail ownership and safe fades/bridge. First inspect current main and fetch/read the S04 branch handoff, then run Node 24 setup/checks. S05 is not dispatched automatically by S04 completion.

**Separate PC owner action:** the S08 one-time project MCP approval remains in interactive Claude Code. Its formerly queued Windows CI is green. That action does not block this completed cloud slice. S09 joins eligible real FL material on PC; S10 supplies owner listening acceptance before S12 Mission Control integration.

No native EUTONOS board or RAM integration is configured. These Markdown owners are recovery records, not native filing receipts. Stable IDs and the slice order are unchanged; the whole campaign remains **IN_PROGRESS**, with effort **unknown**.
