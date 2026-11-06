# EMF — Initial infrastructure

Campaign ID: `campaign-emf-001`  
Short ID: `EMF`  
Owner document: this file  
Status: **IN_PROGRESS - S01-S08 in main; S09 (PC) next**
Recorded 2026-11-03; revised 2026-11-06, America/Chicago

Progress estimate: **unknown**; S01 foundation, S02 player and S03 DJ/request checks pass on Windows, macOS and Linux. The corrected S04 branch passes 130 Node tests, 15 native groups and 11 browser report groups on all three OSes, including zero-error exact same-seed replay at 44.1/48 kHz. S05 adds the checked recording → procedural bridge → recording handoff; it passed 143 Node tests, 19 native groups and 12 browser report groups on Windows only. S06 adds a producer-agnostic importer, the performer palette contract and a mock FL producer (no FL Studio ran); it passed 161 Node tests, 23 native groups and 12 browser report groups on Windows only. S07 links the DJ/bridge and sampler into one demo with the imported mock palette in ordinary playback; it passed 161 Node tests, 23 native groups and 15 browser report groups on Windows only. S08 separately proved a bounded FL Studio authoring path on the Windows PC. Physical output, musical acceptance, the full standalone MVP and broader FL control remain unqualified.

## Outcome

Build a **standalone three-layer MVP** first: one MCP-based Codex/Claude-to-FL Studio authoring interface (optional visual controller), a procedural generator and a DJ controlled through a tiny state/next-song/genre app. Connect EUTONOS Mission Control only after this works. Demonstrate quality recorded playback, several authored procedural identities, deliberate hybrid transitions, understandable controls, persistent catalogue/history and a bounded FL Studio authoring MCP path.

The basic **AI authoring controller is part of MVP**; broader FL automation is later. Mission Control integration is only after the standalone system is proven. This is a delivery milestone inside the campaign, not cancellation of EMF15/EMF16 or a claim the whole campaign is finished. The full acceptance contract below retains those outcomes.

## Scope and authorization

EMF00 preserves the completed initial documentation baseline. On 2026-11-04 the owner assigned S01 foundation, S02 player and S03 DJ implementation/verification/publication in sequence, with detailed repository handoffs and mini chat handoffs. The owner supplied the completed S03 handoff at `66e974c9abbebc6ea9e3aaa6bf55dbd053d8a5bb` and selected **S04 — CLOUD**: the original-palette procedural sampler/phrase source, bounded seeded replay and verification. Automatic approval review initially rejected public publication. The owner subsequently authorized pushing S04 to a separate branch and explicitly excluded main. Branch publication, verification and the branch closeout are authorized; **main integration is outside this delivery**. The work branch is published and the assigned native/browser verification is complete on all three OSes. At that checkpoint implementation scope was bounded to S04; subsequent cloud slices, actual DAW operations and changes to the separate Mission Control repository remain separate assignments. PC S08 is independently complete for its bounded authoring scope. On 2026-11-05 the owner removed automatic CI (EM-DEC030), allowed slices to be built on the PC or in the cloud and merged directly, and asked for **S05 to be built on the PC**, including integration into main.

On 2026-11-06 the owner assigned S07 to a Windows worker on `work/emf-s07-app-20261106` from main `7f86dbb`. This assignment authorizes branch commits and optional branch publication; the coordinating chat owns main integration. EUTONOS CLIs/native records and real FL operations are excluded from the worker scope.

**Platform requirement (owner, 2026-11-04): Windows, macOS and Linux.** Windows may lead the real FL Studio/MCP work, but the shared pack, playback and request contracts must stay portable. Use platform-neutral paths, scripts and browser-facing code; isolate host-specific authoring adapters. Cross-platform CI is engineering evidence, separate from browser/device/listening qualification on each OS. No claim of FL/MCP compatibility on an uninspected host.

When implementation is selected, follow its assigned scope without needless per-stage permission requests. Stage ordering is dependency/priority, not automatic dispatch. This new repo has readable EUTONOS-style owners, not native board configuration. Keep the existing IDs; do not fabricate a native filing or RAM receipt.

## Inputs

Read [Product goal](../PRODUCT_GOAL.md), [First playable](../FIRST_PLAYABLE.md), [Architecture](../ARCHITECTURE.md), [Library/transitions](../LIBRARY_AND_TRANSITIONS.md), [State/API](../STATE_AND_CONTROL_API.md), [Test app](../TEST_APP.md) and [Validation](../VALIDATION.md). The [40-question review](../reviews/MISSION_CONTROL_FIRST_REVIEW.md) explains the revised delivery sequence. FL/model stages additionally read [Unified MCP control](../FL_AGENT_CONTROL.md), [FL integration](../FL_STUDIO_INTEGRATION.md), [Vocals/models](../VOCALS_AND_MODELS.md) and the relevant [guides](../guides/README.md).

Actual workstation, FL version, musical assets and Mission Control interface must be inspected when implementation starts. Published upstream documentation does not prove their installed state.

## Cloud-first execution strategy

Keep one EMF campaign and its original stable **EMF00–EMF19** stage IDs. The stage table below retains wider exit criteria; the numbered **EMF-Sxx slices** are smaller, restartable implementation checkpoints, not a second campaign or work queue.

**Cloud first:** Build and automatically test the DJ, playlist/requests, procedural performer and tiny browser app in a ChatGPT coding environment using the GitHub repository. GitHub source hosting alone is not an audio runtime. Use original/eligible fixture audio and deterministic test sequences. FL Studio, native Windows devices and the authoring MCP cannot block these cloud slices.

**PC integration:** After the first cloud contract is committed, the owner may start real FL Studio/MCP work *in parallel*. It supplies exported audio through the exact same asset format. The real-device listening gate and complete standalone-MVP acceptance occur on PC after cloud and FL paths join. Mission Control integration follows standalone acceptance.

**Completion distinction:** Cloud demo runnable ≠ real FL workflow verified ≠ owner listening accepted ≠ full EMF campaign completed. The larger EMF06–EMF19 scope and reviews remain; optional added genres/vocals/72-hour variety do not block first playback.

## Every slice requires a detailed repo handoff plus mini chat handoff

Follow [Work Model: per-slice handoff policy](../WORK_MODEL.md#per-slice-handoff-policy). At every COMPLETE, PAUSED or BLOCKED boundary, publish/read back an evidence-backed `docs/handoffs/EMF-Sxx-HANDOFF.md`, update this campaign's authoritative status/checkpoint and Current Tasks pointer, then give the owner a **copy/paste mini handoff in the same chat**. The [initial S01 pickup](../handoffs/EMF-S01-PICKUP.md) is an unstarted assignment brief, **not** a completion report. S01 closeout explicitly offers parallel **PC S08**; S07 closeout gives tested SHA and **PC S09** handoff instructions. No automatic background alerts.

## Execution slices — authoritative order and environment

**CLOUD** means ChatGPT with the GitHub repo in a properly provisioned coding/test runtime. **PC** means the owner's Windows workstation for the first actual FL Studio, Codex/Claude, installed-plugin and audio-output qualification. **BOTH** means source and content joined and qualified on that reference PC. These lane labels do not narrow the shared system's Windows/macOS/Linux support requirement.

**Current slice status:** **S01-S06 and S08 are in main** for their bounded scopes. **S07 is COMPLETE**, built on the owner-selected Windows PC and integrated into main. [S07 handoff](../handoffs/EMF-S07-HANDOFF.md), [guide](../S07_APP.md), [review](../reviews/EMF_S07_APP_REVIEW.md). Corrected tested source `9cc24e74d74ef9e2a3022e5dd5ca02737a42df4d`: 161 Node tests, 23 native groups and 15 browser report groups passed on Windows only. macOS/Linux were not run for S07. Physical output/listening and full MVP acceptance remain open. **Next: S09 - BOTH, PC audio**, when separately assigned.

| Slice | Where | Stage(s) informed | Dependency | Checked outcome |
| --- | --- | --- | --- | --- |
| **EMF-S01** | **CLOUD** | EMF01–02 (contract) | EMF00 | Inspect repo; define small portable pack/asset schema, common recorded/procedural playable-source lifecycle, DJ commands/explicit queue and one clock. Create two original or permitted compatible audio fixtures and a sampler palette. Verify fixture provenance and schema. |
| **EMF-S02** | **CLOUD** | EMF03–04 (thin player) | S01 | Select/test one Web Audio renderer, tiny app, play/pause A/B, Now/Next and a cue-checked scheduled A→B transition. Browser/offline tests, build instructions and lifecycle limits. |
| **EMF-S03** | **CLOUD** | EMF04/07/12 (thin DJ) | S02 | DJ state/genre/next/queue/Hold requests with explicit queue priority, cancellation, idempotent retries, no-match fallback and deterministic tests. |
| **EMF-S04** | **CLOUD** | EMF04/10 (first recipe) | S01–02 | Procedural sampler/phrase source sharing clock and `prepare/start/exit/release`; original palette, distinct seeded variations, bounded resources and replay tests. |
| **EMF-S05** | **CLOUD** (built on PC, 2026-11-05) | EMF04/09/11 (handoff) | S03–04 | DJ drives recording A → procedural → different recording B with checked cues, bass/tail handoff and safe fade/bridge; reproducible audio/command tests. |
| **EMF-S06** | **CLOUD** (built on PC, 2026-11-05) | EMF06/15 (contract only) | S01, S04 | Portable import/manifest validation and mock FL-producer/MCP contract tests. Verify sound enters generator regardless of producer; **no claim of actual FL control**. |
| **EMF-S07** | **CLOUD** (built on PC; **COMPLETE** 2026-11-06) | EMF05 cloud scaffold review | S02–06 | Integrated app/demo, CI or repeatable test commands, offline/browser audio checks, review findings and exact artifact/commit SHA. Report **playable engineering proof**, not accepted full MVP. [S07](../S07_APP.md) links the DJ/bridge and original/imported sampler; Windows checks pass; integrated into main after an independent [review](../reviews/EMF_S07_APP_REVIEW.md). |
| **EMF-S08** | **PC** | EMF15 real FL/MCP | **S01 only**; host intake | In disposable FL Studio project, verify single shared broker for Codex/Claude, real persistent note edit/readback, saved project, rendered WAV/loop and receipt reconciliation. May run **in parallel with S02–S07**. |
| **EMF-S09** | **BOTH — PC audio** | EMF02/04/15 integration; targeted EMF18 | S05–06, S08 | Pull exact checked cloud revision; import real FL-produced material with unchanged pack contract. Test A→procedural→B on Windows/audio device; log timing, sound and lifecycle failures. |
| **EMF-S10** | **PC + owner** | EMF05 listening gate; standalone MVP milestone | S07, S09 | Owner listens and accepts/revises the complete creation→generator→DJ→app flow. Playback works with FL/agents closed. **Does not complete EMF19 full release.** |
| **EMF-S11** | **CLOUD** | Remaining EMF06–13 breadth | S07 | Optional post-proof persistence, genres, recipe/history and expanded transition coverage. Can proceed without PC when scope is disjoint. |
| **EMF-S12** | **BOTH — actual MC** | EMF14 | S10, necessary API hardening | Connect Mission Control to the same state/genre/next interface, manual first, optional activity mapping only after verifying signals and overrides. |
| **EMF-S13** | **CLOUD + PC** | Remaining EMF16–19 and open parents | Relevant stage evidence | Optional producer jobs, assembled review, broader Windows qualification and explicit full-campaign owner release decision. |

### Exactly when to involve the PC

- **Handoff #1, after S01 is published:** tell owner the checked Git SHA, pack contract and setup constraints: *“You can pull now to start PC slice S08 in parallel; I'll continue S02–S07 in the cloud.”* This notification is part of the closeout, **not a background automation**. Missing PC integration does not stop the cloud sequence.
- **Handoff #2, after S07 is published:** provide exact build SHA, run commands, artifact/demo, checks and caveats: *“Pull this tested revision for S09 once S08 has produced eligible FL exports.”*
- **Join at S09.** Do not make two implementations of the asset contract, queue or DJ. PC work changes only the producer adapter and supplies real files into the same validated format. Real audio-device testing, listening and host compatibility cannot be declared successful from GitHub CI alone.
- **Next now:** S09 - BOTH, PC audio - is the next separately assigned implementation slice; inspect eligible S08 exports and import through the existing contract. No automatic DAW operation, download, release or Mission Control change is authorized.

## Stage map and sole status owner

| Stage | Status | Outcome | Depends on | Exit evidence |
| --- | --- | --- | --- | --- |
| **EMF00** | **COMPLETE — documentation only** | Original documentation/research baseline | Initial owner brief | Baseline `ee7125e` and retained [Progress](../PROGRESS.md) evidence. |
| **EMF01** | IN_PROGRESS — bounded reviews through S07 checked | Contract/adequacy review | EMF00 | Bounded [S01](../reviews/EMF_S01_FOUNDATION_REVIEW.md), [S02](../reviews/EMF_S02_PLAYER_REVIEW.md), [S03](../reviews/EMF_S03_DJ_REVIEW.md), [S04](../reviews/EMF_S04_PROCEDURAL_REVIEW.md), [S05](../reviews/EMF_S05_HYBRID_REVIEW.md), [S06](../reviews/EMF_S06_IMPORT_REVIEW.md) and [S07](../reviews/EMF_S07_APP_REVIEW.md) reviews cover their stated source boundaries. S04 native replay and full browser verification pass on all three OSes; delivery is complete on its work branch. S08 separately records actual FL host evidence; assembled scope remains later. |
| **EMF02** | IN_PROGRESS — S01 fixtures checked | Portable fixtures then FL production sources | EMF01 contract | Two original recordings and four sample inputs validated locally. S09 still must verify eligible FL exports through the same pack schema. |
| **EMF03** | IN_PROGRESS — S02 cloud renderer checked | Initial renderer | S01 fixtures | One native Web Audio backend selected; S02 offline rendering and live Chromium checks pass on Windows/macOS/Linux. Real audio-device and listening qualification remains on the reference hosts. |
| **EMF04** | IN_REVIEW — S01–S07 in main | Working standalone cloud scaffold | S01–06 | S02/S03 one-clock recording/DJ evidence remains. The S04 sampler passes Node, exact native replay and the full browser gate on Windows/macOS/Linux. The S05 hybrid handoff and the S06 importer/mock producer pass Node, native and browser checks on Windows only. S07 links the existing demo surfaces and exposes imported mock-palette playback (Windows only). **Not blocked by installed FL Studio.** |
| **EMF05** | IN_PROGRESS — S07 scaffold review done; S10 listening open | Scaffold review and owner listening | S07 cloud proof; S09 PC integration | S07 self-review, an independent [review](../reviews/EMF_S07_APP_REVIEW.md) and technical gates pass on Windows ([handoff](../handoffs/EMF-S07-HANDOFF.md)); this is engineering review, not listening. S10 adds full FL-backed real PC listening and owner acceptance. |
| **EMF06** | IN_PROGRESS — S06 importer contract checked | Versioned library and importer | EMF05 | [S06](../S06_IMPORT.md) imports any producer's delivery (`em.producer-delivery.v0`) into the unchanged pack format: measured PCM, canonical WAV headers, producer-hash checks, silent-tail trimming, rights evidence, unverified producer record and useful coded refusals, with an `IMPORT.json` receipt. Windows only. A persistent versioned library, catalogue and real FL material (S09) remain open. |
| **EMF07** | IN_PROGRESS — S03 local request subset checked | Transport and state lifecycle | EMF05–06 | S03 separates requested/prepared/renderer-active evidence, Hold, canonical retry effects and cancellation. Wider musical dwell, expiry/durable history and restart protocol remain open. |
| **EMF08** | PLANNED | Manual listening app | EMF07 | Simple MC-facing panel plus advanced lab, pending display, skip/favorite, save-vibe and accessible controls. |
| **EMF09** | IN_PROGRESS — S05 thin proof checked | Recorded transition path | EMF06–08 | S05 adds checked route cues, A's one-bar exit fade and B's full-level phrase entry around a bridge, with cancellation restoring A exactly. Reviewed phrase mix, role substitution and safe fallback across more content remain open. |
| **EMF10** | IN_PROGRESS — first finite S04 performer cloud-verified | Procedural recipe performer | EMF06–08 | One original-palette eight-bar performer has deterministic plan/resource tests, exact native replay and browser qualification on all three OSes. At least three distinct families, palettes and listening across selected/held-out seeds remain open. |
| **EMF11** | IN_PROGRESS — S05 small proof checked | Hybrid musical handoffs | EMF09–10 | S05 proves one route under policy `s05-hybrid-handoff@1`: shared tempo/meter/key checks, percussion-only lead-in and tail, and bass ownership that changes only across silence (Windows native evidence). Generalizing it, vocal ownership, latency alignment and listening remain open. |
| **EMF12** | IN_PROGRESS — S03 thin selection checked | DJ selection and persistent history | EMF11 | S03 provides deterministic supported/eligible state/genre selection and manual FIFO priority. Procedural selection, recency, persistent history, replayable seeds and bounded durable logs remain open. |
| **EMF13** | PLANNED | Transition graph and coverage | EMF12 | Directed continuation/bridge routes and dead-end/coverage diagnosis, not all-pairs discovery or universal compatibility. |
| **EMF14** | PLANNED — after S10 | Mission Control request adapter | S10, required API refinement | S12 real MC integration only after standalone MVP listening acceptance. |
| **EMF15** | IN_PROGRESS — S08 bounded path verified on Windows | Unified FL Studio MCP authoring control | S01 contract, actual PC environment | [S08](../handoffs/EMF-S08-HANDOFF.md) verified real note/tempo/clip edits, FL-side readback, save, CLI render, export checks, reconcile and recovery through one facade for Claude Code and Codex. Live GUI control, mixer/plugins, render settings and non-Windows FL remain open; S06 adds mock-producer contract tests through the same broker with no FL Studio; S09 imports real outputs. |
| **EMF16** | PLANNED — later | Optional production-job boundary | EMF06, EMF15 | Background model jobs are optional; basic agent-assisted FL creation does not require them. |
| **EMF17** | PLANNED | Final assembled implementation review | EMF06–16 | Review actual combined paths, including authoring and MC integration; re-review material corrections. |
| **EMF18** | PLANNED | Windows-first and cross-platform listening/operational qualification | EMF17 | Named Windows reference environment plus macOS/Linux playback qualification, real work sessions, recovery/load evidence and scope-matched endurance. CI alone cannot close real-device/listening criteria. |
| **EMF19** | PLANNED | Owner acceptance and release handoff | EMF18 | Explicit listening decision, accepted limits, verified target state, setup/known issues and selected next work. |

Independent work may proceed within an assigned scope when prerequisites and write boundaries permit. Do not skip a material review correction or interpret the review table as approval of untested code. A usable pilot needs targeted checks and owner listening feedback before use; it does not wait for authoring extensions but does not inherit full release acceptance either.

## Named review gates

### EMF01 — campaign adequacy review

Scope: intended MC experience, actual source/consumer/FL environment, fixtures and candidate renderer. Challenge the need for a general production platform before sound. Prerequisites: source inspection and enough real environment evidence to distinguish available capability from documentation. Exit: KEEP/CHANGE/DEFER, bounded fixture/backend plan and one next executable step. The documentation review is an input, not evidence the environment was checked. Model preference: higher-capability, advisory; owner choice and actual availability govern.

### EMF05 — scaffold correctness and efficiency review

Scope: actual renderer/clock, control/MC path, prepared musical handoffs, file/data handling, startup and recovery. Prerequisite: runnable scaffold and recorded execution/listening evidence. Exit: small set of material corrections or KEEP; affected contracts re-reviewed before broadening. A poor musical result should trigger a targeted music change, not another layer of framework. Model preference: higher-capability, advisory. Independent review is required for this gate where the assigned review contract calls for it; no such review occurred in this docs-only update.

### EMF17 — final assembled implementation review

Scope: recorded/procedural DJ, library/history/graph, MC and agent controls, FL bridge, production jobs, eligibility and recovery. Prerequisites: completed implementation for the declared scope and source-pinned evidence. Exit: KEEP/CHANGE/DEFER and qualification matching actual behavior. Do not infer the owner's taste approval. Model preference: higher-capability, advisory.

Reviews are bounded review-only checkpoints; they do not silently implement or widen scope. Preserve unaffected evidence and re-review material fixes. Safety checks required earlier are not delayed to a named gate.

## Full campaign completion criteria

These IDs and meanings are retained. M1 and M2 are smaller milestone evidence, not a waiver of the campaign contract.

| Check ID | Required result | State |
| --- | --- | --- |
| EMF-C01 | Reproducible setup and one selected reference playback backend | S02 cloud setup/backend checked; physical reference-host qualification pending |
| EMF-C02 | Externally requested states with visible pending and audible outcomes, including actual MC | Pending |
| EMF-C03 | Several distinct recipes and a reviewed recorded/stem fixture set | Pending |
| EMF-C04 | Recorded/procedural/recorded handoffs and at least one non-direct bridge | Engineering proof only (S05, Windows); listening pending |
| EMF-C05 | Persistent catalogue/history, identity/seed replay and eligibility filtering | Pending |
| EMF-C06 | Transition route/coverage diagnostics and intentional fallback | Pending |
| EMF-C07 | Useful bounded FL authoring MCP operation with actual artifact readback | Met for the S08 bounded scope on Windows ([evidence](../handoffs/EMF-S08-HANDOFF.md)); broader FL actions later |
| EMF-C08 | Optional producer jobs cannot interrupt audio or silently admit output | Pending |
| EMF-C09 | Three named reviews completed for the implementation they cover | Pending |
| EMF-C10 | Required failure/recovery, resources and listening checks on the reference environment | Pending |
| EMF-C11 | Current docs/setup match implemented behavior and limitations | Pending |
| EMF-C12 | Explicit owner acceptance of the initial musical experience | Pending |

All required checks and EMF19 must be satisfied for full completion. A provider may remain unsupported with an explicit limit; that does not remove the production-boundary test or claim singing has shipped. Three-day breadth, arbitrary-song accompaniment, all genres, all FL actions, remote streaming and a broad public pack catalogue are later outcomes, not hidden criteria for the first pilot.

## Current checkpoint

### EMF-S07 complete

**S07 COMPLETE for its bounded demo scope**, 2026-11-06. Built on the owner's Windows PC on `work/emf-s07-app-20261106` from main `7f86dbb2aa19016348b082c4f9058f237aed17e4` and integrated into main. Worker-tested source `0cec058b8f8b4d9b5f6a8ddf5c1a5fd01139fd11`; corrected tested source **`9cc24e74d74ef9e2a3022e5dd5ca02737a42df4d`**. [Detailed handoff](../handoffs/EMF-S07-HANDOFF.md), [guide](../S07_APP.md), [review](../reviews/EMF_S07_APP_REVIEW.md).

The integrated engineering demo links the existing DJ/bridge and sampler; the sampler now plays the imported S06 mock palette through ordinary controls and the existing renderer. Same-seed palette comparison, silent selection, context disposal, selection guards, ownership transfer, navigation cleanup and failure recovery are checked. DJ/hybrid generalization remains S09. The self-review corrected the residual S01 recipe binding, guarded restored-page pack loading, and updated stale demo instructions. A separate read-only review found one low–medium restore race and five low items; all were corrected with new browser assertions. Neither review is listening acceptance.

At the corrected tested source, `npm.cmd run check` passed **161 Node tests**, deterministic fixture regeneration and six WAV validations. `npm.cmd run check:browser` passed **23 native offline groups and 15 browser report groups**, with no page script errors. **Windows only**, Node 26.12.1 (declared 24), Chromium 151.0.7922.34. **macOS/Linux, physical output and listening NOT TESTED. No FL Studio ran.**

**Current action:** none assigned. The coordinator updated the board, NAV, RAM and acceptance. **One next implementation slice: S09 - BOTH, PC audio**, when separately assigned, joining eligible real FL outputs through the same contract. Campaign effort percentage remains unknown; S07 engineering proof is not an accepted MVP.

### Historical S06 checkpoint

**S06 COMPLETE for its bounded contract scope**, 2026-11-05. Built on the owner's Windows PC at the owner's request (the slice table labels S06 CLOUD) from main `c64df9a604733f00a87de3aa7021cc5525d15dd1` and integrated into main. Tested source: **`8708c7806bb1ffc1d68c3ed8c2f34d29af0d9f4d`**. [Detailed handoff](../handoffs/EMF-S06-HANDOFF.md), [guide](../S06_IMPORT.md), [review](../reviews/EMF_S06_IMPORT_REVIEW.md), decision EM-DEC032.

Any producer can now hand over a data-only delivery (`em.producer-delivery.v0`) that the importer turns into an `em.audio-pack.v0` pack. It measures every WAV itself, keeps the PCM unchanged behind a canonical header, checks the producer's own hashes, trims only a silent tail, requires rights evidence, never grants listening review and writes an `IMPORT.json` receipt. The S04 performer now plays any palette meeting `s06-performer-palette@1` instead of the S01 palette alone; two producers' palettes give the same events. A mock FL producer drives the real S08 broker over MCP against a synthesizing mock host and is imported by the same path. **No FL Studio ran; S06 makes no claim of FL control.**

On Windows only (Node 26.12.1, although the package declares Node 24; headless Chromium 151): `npm run check` passed **161 Node tests** with unchanged fixture and media checks, and `npm run check:browser` passed **23 native offline groups** and **12 browser report groups**. The four new native groups load the imported mock pack in the browser and compare each stereo output channel with an independent sample sum, for the palette at 48 and 44.1 kHz and the A → B route at 48 kHz; at 44.1 kHz the sum reads the delivered PCM bytes. An independent review's medium finding (the receipt said `compatible` for packs the browser player refuses) was corrected with a `browser_player` receipt check, and four low findings were corrected. **macOS and Linux were not run. Physical output and human listening are NOT TESTED.**

**One next action: EMF-S07 — CLOUD** (integrated app/demo, repeatable test commands, scaffold review and an exact tested SHA), when separately assigned, from current main. It may be built on the PC instead if the owner chooses. First read the S06 handoff, then run the Node 24 setup and checks.

### Historical S05 checkpoint

**S05 COMPLETE for its bounded engineering scope**, 2026-11-05. Built on the owner's Windows PC at the owner's request (the slice table labels S05 CLOUD) from main `a1a9df336aa69ed3676447828f02c2b806db726d` and integrated into main. Tested source: **`a9fa01d3e43a304e8648f455cb3e56ef5b69bfda`**. [Detailed handoff](../handoffs/EMF-S05-HANDOFF.md), [guide](../S05_HYBRID.md), [review](../reviews/EMF_S05_HYBRID_REVIEW.md), decision EM-DEC031.

The DJ can schedule recording A → a seeded procedural bridge → recording B under one code-versioned policy, `s05-hybrid-handoff@1`. The planner checks the route, performer, tempo, meter, key, bar-aligned cues and scheduling lead before any audio effect. The bridge enters at A's exit cue with percussion only while A fades for one bar; its bass and harmony start once A is silent; B enters at full level on the bridge's phrase exit while only bridge percussion fades for one bar. The page offers the bridge as a Handoff choice; crossfade remains the default.

On Windows only (Node 26.12.1, although the package declares Node 24; headless Chromium 151): `npm run check` passed **143 Node tests** with unchanged fixture and media checks, and `npm run check:browser` passed **19 native offline groups** and **12 browser report groups**. The four new native groups render A, the bridge and B on separate channels at 44.1 and 48 kHz against an independent oracle (maximum error ≤ 1.1e-7) and confirm bass ownership, at most two overlapping sources, headroom, bitwise same-seed replay, the `end` exit and exact pre-bridge cancellation. **macOS and Linux were not run. Physical output and human listening are NOT TESTED.**

At that checkpoint the next action was EMF-S06; the S06 checkpoint above supersedes it.

### Historical S04 checkpoint

**S04 COMPLETE for its assigned cloud engineering scope**, 2026-11-04. At delivery, main stayed at `66e974c9abbebc6ea9e3aaa6bf55dbd053d8a5bb` by explicit owner instruction. The PC later integrated the branch into main, together with the EUTONOS registration. Branch: `work/emf-s04-procedural-20261104`. Verified runtime/test source: **`73c456a147dcf24161ce22187e5e62320c5141b5`**, tree **`92362e7d5dd6552c0255ae0e9220115d104fe052`**, identical to locally tested `f4c804075db713918ddf7a09a3a4f622b7e930c1`. The containing closeout adds only documentation/evidence. [Detailed handoff](../handoffs/EMF-S04-HANDOFF.md), [guide](../S04_PROCEDURAL.md), [review](../reviews/EMF_S04_PROCEDURAL_REVIEW.md), [retained evidence](../evidence/emf-s04/README.md).

The original public push was rejected by automatic approval review. The owner then authorized a separate-branch push and explicitly excluded main. Command-line Git lacked a login; the connected GitHub app published the authorized source and documentation trees. **Main integration is outside this delivery, and its intentional absence is not a blocker.** Original failure and local/public commit mappings remain in the handoff and Progress.

The finite eight-bar source uses immutable seed/state plans, unchanged original samples, the recording player's clock/transport, declared exits, bounded note/sample resources and one pending/resolved palette decode. Two fixed mix buses preserve strict same-seed native replay. Audition replacement and whole-performance fades do not supply S05 overlap, bass/role transfer or recorded/procedural routes.

[Corrected run 41961109555](https://github.com/splatter85/EUTONOS-Music/actions/runs/41961109555) passed **130 Node tests**, seven unchanged fixture files, six WAV validations, **15 native audio groups** and **11 browser report groups** on Windows, macOS and Linux. Same-seed replay has zero differing samples, zero differing bit patterns and zero maximum delta at both 48 kHz and 44.1 kHz on each OS. Independent sample/lifecycle checks retain the original `0.000003` tolerance. The independent corrected source/player review passed 18 focused cases; compiler bounds cover 560 seed/state combinations. Raw reports, artifact digests and inspected desktop/mobile screenshots are retained.

Initial run 41959790896 and diagnostic run 41960453351 passed 127 Node tests and 13 of 15 native groups but failed strict replay. Exact plans/decoded samples with tiny differences only under three/four-contributor mixing motivated the fixed-pair correction; the unchanged gate subsequently passed. Historical failures are not relabelled as success.

At that checkpoint the next action was EMF-S05; the S05 checkpoint above supersedes it. Physical output and human listening remained **NOT TESTED**.

**PC owner action:** the one-time project MCP approval in interactive Claude Code remains as specified in S08. Its formerly queued Windows CI is green ([run 41909105766](https://github.com/splatter85/EUTONOS-Music/actions/runs/41909105766)). Private unauditioned renders stay on PC. S09 joins paths; S10 listening acceptance still precedes S12 Mission Control.

### Historical S03 checkpoint

S03 is complete and integrated in the inspected main at `66e974c9abbebc6ea9e3aaa6bf55dbd053d8a5bb`. Tested source `71d954534087ff1637b8ff0e8fc51c393a89abfa` passed 101 Node tests, unchanged fixture/media checks, nine native offline checks and the full S03 browser flow on Windows/macOS/Linux at [run 41925003036](https://github.com/splatter85/EUTONOS-Music/actions/runs/41925003036). Cancellation restored full A with zero measured sample error at 44.1/48 kHz. The [S03 handoff](../handoffs/EMF-S03-HANDOFF.md) and retained original evidence own that historical scope; these results do not qualify S04. Physical output and listening were untested.

### EMF-S08 PC checkpoint

**S08 COMPLETE**, 2026-11-04, PC lane, from main `25c26bf9d5c6d0c2352dc0ee8ebfe2ff958978ec`. Claude Code wrote an original 8-bar, 120 BPM A-minor sketch (chords, bass, lead, drums; 221 notes) through the `eutonos-music` MCP facade into a disposable copy of an FL factory template. FL Studio 26.1.7 loaded the saved project and its MIDI export matched every note and the tempo; the FL CLI render (PCM16 stereo 44.1 kHz, 19.98 s) passed export checks; the pack validated with the unchanged S01 loader. Codex used the same facade, was refused while Claude held the writer lease, then made a bounded verified edit. Live refusals and recovery and simulated failure cases are listed in the [S08 handoff](../handoffs/EMF-S08-HANDOFF.md). `npm run check` passed 66 tests. Renders and packs stay owner-local (factory-instrument rights); **nobody has listened**. At that S08 closeout, the next cloud slice was S03; the current checkpoint above now advances the next separately assigned pickup to **EMF-S06**.

## Resume and closeout

Inspect branch/HEAD/working changes and preserve unrelated work. Read the current goal, first-playable contract and selected stage. Verify old evidence at its original version and assess current applicability separately. Record the assigned scope and next check before substantive work. Reconcile uncertain side effects before retrying; do not invent operation identities.

At a meaningful checkpoint report practical outcome, checks/limits, position in the current milestone/stage map, effort with basis or unknown, plan assessment, instruction changes and the next concrete step. Keep native filing, Git publication/integration, installation, runtime qualification and owner acceptance separate. Actual listening—not model size or reasoning effort—determines musical acceptance.
