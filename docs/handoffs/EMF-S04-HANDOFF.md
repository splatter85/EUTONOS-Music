# EMF-S04 — original-palette procedural source handoff

**Campaign:** EMF / `campaign-emf-001`  
**Slice:** EMF-S04  
**Disposition:** **BLOCKED at publication and native verification; implementation is a local candidate, not complete or integrated into main.**  
**Environment:** CLOUD; Linux coding runtime, Node 24.22.1, npm 11.9.0, TypeScript 5.9.3, Playwright 1.62.1.  
**Recorded:** 2026-11-04, America/Chicago  
**Inspected base/main:** `66e974c9abbebc6ea9e3aaa6bf55dbd053d8a5bb`, tree `0bad48392217372af9a491b699f908bc6fd86b13`.  
**Local branch:** `work/emf-s04-procedural-20261104`  
**Locally tested implementation commit:** `d921382ba948b5bad370751c90b39fb695888058`, tree `a28ff92757aa7c03f479ef4f5921290cfb148008`.  
**Publication:** Automatic approval review rejected the push to the public repository. Read-only remote inspection found main still at the inspected base and no S04 branch. This handoff and its closeout are local only; no S04 GitHub commit, CI run, native report or integration receipt exists.

The [campaign checkpoint](../campaigns/EMF_INITIAL_INFRASTRUCTURE.md#current-checkpoint) owns current status. This file records the blocked checkpoint; its containing documentation commit is reported in the completing chat, since a file cannot name its own commit hash.

## Assignment and inspected predecessor

The owner selected **S04 — CLOUD** after the completed [S03 handoff](EMF-S03-HANDOFF.md): build the first procedural sampler/phrase source over the original palette, retain the common clock and `prepare/start/exit/release` lifecycle, and establish bounded resources and reproducible seeded variation. The worker inspected a clean main at the exact owner-supplied containing commit and read the repository instructions and canonical contracts before implementation. Node 24 setup and the existing 101-test baseline passed.

The scope is one finite performer and a source audition path. S05 owns recording A → procedural → recording B and its musical handoff policy. The two-recording DJ, one directed route, original media, FL authoring facade and private PC material retain their existing boundaries. S08's green Windows CI is predecessor evidence, not S04 validation. No DAW or Mission Control operation was performed.

## Delivered local changes

| Files | Actual implementation |
| --- | --- |
| `src/phrase-plan.ts`, `tests/phrase-plan.test.ts` | An immutable, compiled, versioned eight-bar performer with explicit uint32 seed, Explore/Drive arrangement, four-bar statement/answer, bounded role choices, phrase fills and cadence rests. Exact replay hashes and a 560 seed/state constraint sweep are checked. |
| `src/procedural-source.ts`, `tests/procedural-source.test.ts` | Native Web Audio sample scheduling on the caller's existing clock, verified four-sample decode, declared phrase exits, bounded fades, Stop, future-exit cancellation and idempotent release. Deterministic doubles check lifecycle and failure effects. |
| `src/player.ts`, `tests/procedural-review.test.ts` | Procedural audition through the existing context, output gain, clock and transport; one shared pending/resolved palette decode; stale-operation, ownership, rights and Pause/Resume regressions. |
| `web/procedural.html`, `web/procedural.ts`, existing page/style/server/export files | A separate seed/state audition page with Play, Pause/Resume, Stop, Volume/Mute, selected/clock-active diagnostics, hidden-page pause and the existing cooperating-tab lock. Browser execution is pending. |
| `web/procedural-checks.ts`, `web/checks.ts`, `scripts/browser-check.ts`, `.github/workflows/validate.yml` | Six additional native offline groups and one sampler browser group, retaining the S03 flow; Node 24 Windows/macOS/Linux matrix and S04 artifact names. Written and compiled, **not run natively**. |
| [S04 guide](../S04_PROCEDURAL.md), [review](../reviews/EMF_S04_PROCEDURAL_REVIEW.md), [local evidence](../evidence/emf-s04/README.md), canonical owners | API/limits, bounded review findings, raw passing Node log and an explicit blocked recovery route. |

There are no new runtime dependencies, sample recordings, proprietary assets, private renders or credentials in this change. The original six WAVs, manifest, generator and provenance are unchanged. The new performer uses **s01-foundation@1**, **s01-recipe@1**, **s01-palette@1** and executable identity **s04-s01-performer@1**. Playback remains explicitly opted into `fixture-only` status and checks both playback and sample-reuse permission. [S01 provenance](../../fixtures/s01/PROVENANCE.md) remains authoritative for the audio.

### Source behavior and resource boundary

The source plays a finite sixteen seconds: eight bars of 4/4 at 120 BPM, constant A minor, unchanged sample pitch. Seed/state controls rhythm and arrangement; it does not imply unique music for every uint32 seed. Independent deterministic streams govern drums, bass, percussion and harmony. The source's `reference` is the recipe revision; full performance identity requires the immutable plan, including performer version, pack/palette/sample bindings, seed and state. JSON-rehydrated or caller-forged event lists are refused; replay recompiles the recorded identity against the exact eligible source versions.

The plan is symbolic preparation. Native note scheduling happens only after explicit Play, verified decoding and ownership. All note starts use the same `WebAudioClock` as the recording player. Every finite note is committed before entry, with a muted master gate until allocation and schedule validation finish. Timers and UI refreshes do not start notes. A partial allocation/schedule failure releases the graph before opening the gate. Resource ceilings are **256 scheduled note sources**, **four simultaneous sounding intervals including tails**, and **1,048,576 Float32 sample values / 4 MiB** across the four decoded samples. These are code-enforced bounds, not measured process memory or endurance results.

The only entry is quarter zero. Declared exits are `phrase` at quarter 16/eight seconds and `end` at quarter 32/sixteen seconds. Entry/exit fade lengths are construction-time output-frame options. A nonzero fade past the natural end is refused. A future exit can be cancelled with the concrete source's `cancelTransition()` extension before its onset; this is not part of the common interface. Generation invalidation cannot prevent release from cancelling future notes.

`SmallPlayer.playProcedural()` is a replacement/audition operation: it releases old voices and invalidates their generation. It does not schedule an overlapping hybrid handoff. `transitionOut()` fades the whole precommitted performance, including later attacks during the fade; it does not implement tails-only release or separate bass/role ownership. S05 must define and verify these policies before adding a route.

Stop retains one bounded verified palette cache for replay; disposal drops the player's references. Repeated Play/Stop shares the same pending four-sample decode instead of starting parallel decode chains. Each intent still rechecks the current pack, complete sample metadata and permissions. A changed palette binding requires a reload. Physical memory reclamation is the browser's responsibility.

## Executed verification and explicit gaps

| Command or check | Actual result | Evidence and limit |
| --- | --- | --- |
| `npm ci --ignore-scripts` on Node 24.22.1 | PASS | Existing locked dependencies installed; no dependency or lockfile change. |
| Baseline `npm run check` at main `66e974c…` | PASS | 101 Node tests, seven deterministic fixture files, six validated WAVs. |
| Final `npm run check` for local source `d921382…` | **PASS** | **127 tests, 127 pass, zero failed/skipped**; TypeScript build, seven byte-identical regenerated fixture files and all six media validations. [Retained raw log](../evidence/emf-s04/local-check.log). |
| Phrase compiler suite | PASS | Ten tests include pinned event digests, 12 selected plus 12 designated held-out seeds, and 256 additional seeds across both states: **560 seed/state combinations** in the bounds sweep. Timing/structure varies in the tested sets. |
| Independent focused source/player review | PASS on the earlier working candidate | Six added reviewer regressions plus eleven existing player cases: **17 passed**, before final role-stream/end-rounding edits. The final 127-test integrator run includes all six regressions; the reviewer then read final source/log. [Review](../reviews/EMF_S04_PROCEDURAL_REVIEW.md). |
| Native sampler scheduling in Node doubles | PASS as call/state tests | The source tests cover both 44.1 and 48 kHz calculations, scheduling, cleanup and failures; doubles do not render audio. |
| Native offline rendering | **NOT RUN for S04** | Six new groups are written, for a total of fifteen with S03's nine. The new groups compare independent sample sums, replay/variation, entry/exit envelopes, Stop, cancellation and stale release at 44.1/48 kHz. No measured S04 PCM result exists. |
| Full S03 + sampler browser flow | **NOT RUN for S04** | Harness compiled; no S04 UI screenshot/report or live browser result was produced. |
| GitHub Actions on Windows/macOS/Linux | **NOT RUN for S04** | No published S04 ref exists to trigger the workflow. Prior green S03/S08 runs are historical. |
| Physical speaker/headphone output | **NOT TESTED** | No device output qualification. |
| Human listening / musical acceptance | **NOT TESTED** | No seed, arrangement or hybrid transition was auditioned by a listener. |

The final local check log belongs to the implementation tree above. This closeout changes only documentation/evidence, not runtime, tests, fixtures, dependencies or workflow. Local documentation checks verify links, stable IDs, source pin applicability and the unchanged historical Progress prefix. The full campaign remains in progress; effort percentage is unknown.

The new native checks retain the existing **0.000003** maximum absolute sample-error tolerance. They target same-browser/rate replay and compare different seeds; they do not promise identical audio bytes across browsers or operating systems. Their actual measurements must be recorded after execution. The source accepts integer native context rates from 8 to 192 kHz, but native verification is planned only at 44.1 and 48 kHz; other rates are unqualified.

## Review findings and corrections

An independent agent reviewed the source/transport and added six regression cases without changing the implementation. It found a material resource issue: rapid replaced/cancelled Play requests could each launch a decode chain. The integrator changed this to one bounded pending/resolved four-sample cache, retaining per-intent validation and generation/ownership checks. The focused reviewer suite then passed on that working candidate. After later role-stream/end-rounding edits, the integrator reran the full 127-test suite including those regressions; the reviewer read the final source and log without claiming another independent execution.

A source test also exposed a one-frame end calculation at 44.1 kHz. The corrected scheduler converts the absolute authored endpoint from integer native-sample frames, then bounds it by the actual decoded length. This avoids fractional-second rounding that could extend a one-shot into the next same-role event. The independent native oracle uses the same documented authored-frame convention with separate arithmetic; no comparison tolerance was widened. Native execution remains pending.

Review also clarified cache lifetime, plan versus recipe identity, replacement semantics, whole-performance fade behavior and the selected/ready/playback UI wording. These are documented for S05 so a caller cannot mistake audition support for an already-qualified hybrid transition. The bounded source disposition is KEEP after corrections, subject to the explicit native/publication gate; it is not S04 completion or listener acceptance.

## Blockers, last verified state and recovery

### Publication

The attempted shell operation created local commit `d921382…` and then requested a Git push. **Automatic approval review rejected the external publication** because the operation would publish the complete new source, tests, workflow and documentation to the public `splatter85/EUTONOS-Music` repository without explicit authorization for that payload. A read-only remote check confirmed main at `66e974c…` and no branch `work/emf-s04-procedural-20261104`. There was no successful S04 upload or integration. No alternative GitHub write API was used to bypass the rejection.

Repository handoff policy calls for publication even at a blocked boundary, but this approval rejection prevents that step. The local handoff, source and raw evidence make the blocked result reviewable. The owner must explicitly approve publishing these S04 changes to the named public repo, running its CI and integrating into main after required checks pass before those external writes resume. Ordinary local review and documentation are complete without that approval.

A fresh GitHub clone cannot recover these unpublished S04 commits. Preserve this checkout or the **`EMF-S04-local.bundle`** recovery file supplied in the completing chat. That incremental Git bundle contains the implementation and documentation commits and requires the public intake commit `66e974c9abbebc6ea9e3aaa6bf55dbd053d8a5bb`, which an up-to-date clone of the repository already has. Its branch tip and SHA-256 are supplied with the file after local verification. To recover into an existing clone, replace the example absolute bundle path with the downloaded file's path:

```sh
git fetch /absolute/path/to/EMF-S04-local.bundle work/emf-s04-procedural-20261104
git switch -c recovery/emf-s04 FETCH_HEAD
```

This recovery is local and does not publish anything. Inspect the recovered tree and current upstream state before continuing; public writes still require the recorded authorization.

### Browser execution

The local Chromium launch failed because its process-singleton socket was denied (`Operation not permitted`). No runtime restriction was bypassed. The connected Browser plugin was unavailable without an originating browser context. A permitted cloud-browser fallback could not reach the loopback server (`ERR_CONNECTION_REFUSED`). These are environment failures, not successful audio/UI checks and not demonstrated application failures. The existing three-OS GitHub Actions route remains the next verification environment once publication is authorized.

### Resume procedure

1. Inspect the current checkout, branch, worktree and remote main. Read this handoff and the [campaign checkpoint](../campaigns/EMF_INITIAL_INFRASTRUCTURE.md#current-checkpoint). Preserve the local source and documentation commits; reconcile any later upstream work before publication.
2. Verify explicit owner approval for the public source/test/workflow/documentation publication and eventual checked integration. Do not route around the recorded rejection with another tool.
3. With approval, publish the scoped S04 branch and read back the exact commit/tree. Trigger the existing Node 24 Windows/macOS/Linux validation workflow. If this workspace or dependencies changed, run `npm ci --ignore-scripts` and `npm run check` first.
4. Run the written native/browser gate (`npm run check:browser`; CI installs Chromium and runs the same checked source). Investigate concrete failures, preserve the original tolerance and source applicability, and repeat only affected checks plus required gates after fixes.
5. Retain actual JSON reports and inspected screenshots with source/run/platform provenance under `docs/evidence/emf-s04/`. Keep the existing local check log as historical evidence; add new logs instead of relabelling it.
6. Update this handoff, campaign and Current Tasks with actual outcomes. Only after all assigned engineering gates pass, publish/read back the closeout, integrate the verified revision into main, and give the owner its containing SHA and mini handoff. Physical output/listening must remain explicitly untested unless separately performed.

## One next actionable slice

**Resume EMF-S04 — CLOUD**, completing publication and native verification of the existing procedural candidate. **Do not start S05 while S04 remains blocked.** The first action is to inspect current local/remote state and verify publication authorization; after approval, publish and run the already-written three-OS checks. The intended subsequent S05 assignment is the recorded/procedural/recorded handoff, only after a completed S04 closeout.

**Separate PC owner action:** the S08 one-time project MCP approval remains in interactive Claude Code. Its formerly queued Windows CI is green, as supplied by the owner; it does not resolve or cause the S04 cloud block. S09 still joins eligible real FL material on PC, S10 supplies owner listening acceptance, and S12 follows that standalone acceptance. No new PC action was executed or requested to substitute for the cloud gate.

No native EUTONOS board or RAM integration is configured in this checkout. The updated Markdown owners are readable recovery records, not native filing receipts. The sequence and stable IDs are unchanged; S04 is blocked at delivery/verification, and the overall campaign remains **IN_PROGRESS** with effort **unknown**.
