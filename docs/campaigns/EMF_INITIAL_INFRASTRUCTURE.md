# EMF — Initial infrastructure

Campaign ID: `campaign-emf-001`  
Short ID: `EMF`  
Owner document: this file  
Status: **IN_PROGRESS — EMF-S01/S02 COMPLETE; EMF-S08 PC COMPLETE; EMF-S03 READY**
Recorded 2026-11-03; revised 2026-11-04, America/Chicago

Progress estimate: **unknown**; S01 foundation and S02 cloud player checks pass, and S08 proved a bounded FL Studio authoring path on the Windows PC. Physical output, musical acceptance, the full standalone MVP and broader FL control remain unqualified.

## Outcome

Build a **standalone three-layer MVP** first: one MCP-based Codex/Claude-to-FL Studio authoring interface (optional visual controller), a procedural generator and a DJ controlled through a tiny state/next-song/genre app. Connect EUTONOS Mission Control only after this works. Demonstrate quality recorded playback, several authored procedural identities, deliberate hybrid transitions, understandable controls, persistent catalogue/history and a bounded FL Studio authoring MCP path.

The basic **AI authoring controller is part of MVP**; broader FL automation is later. Mission Control integration is only after the standalone system is proven. This is a delivery milestone inside the campaign, not cancellation of EMF15/EMF16 or a claim the whole campaign is finished. The full acceptance contract below retains those outcomes.

## Scope and authorization

EMF00 preserves the completed initial documentation baseline. On 2026-11-04 the owner assigned **S01 implementation, original eligible fixtures, automated validation and GitHub publication**, then **S02: a small Web Audio player, Play/Pause A/B, Now/Next and a cue-checked A→B transition on one clock**, with a detailed published repository handoff and mini chat handoff. Current implementation authorization is bounded to S02; subsequent cloud slices, actual DAW operations and changes to the separate Mission Control repository remain separate assignments. PC S08 may proceed independently under the owner's separate assignment.

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

**Current slice status:** **S01 and S02 COMPLETE** for their bounded cloud engineering scopes. S02 uses one native Web Audio clock for Play/Pause A/B, Now/Next and the authored A→B route. At source `c7f75321bf034517fd0b2fde41298285b89f26b9`, 54 Node tests, deterministic fixture/media checks, seven native offline audio checks and live Chromium behavior passed on Windows, macOS and Linux. [Detailed S02 evidence](../handoffs/EMF-S02-HANDOFF.md). **S03 READY — CLOUD** is the next pickup; it has not started. **S08 COMPLETE — PC** (2026-11-04): one MCP facade shared by Claude Code and Codex edited a disposable FL project, FL read it back, rendered WAV and the result validated as an `em.audio-pack.v0` pack. [Detailed S08 evidence](../handoffs/EMF-S08-HANDOFF.md). Physical listening remains unverified; later slices retain their prerequisites.

| Slice | Where | Stage(s) informed | Dependency | Checked outcome |
| --- | --- | --- | --- | --- |
| **EMF-S01** | **CLOUD** | EMF01–02 (contract) | EMF00 | Inspect repo; define small portable pack/asset schema, common recorded/procedural playable-source lifecycle, DJ commands/explicit queue and one clock. Create two original or permitted compatible audio fixtures and a sampler palette. Verify fixture provenance and schema. |
| **EMF-S02** | **CLOUD** | EMF03–04 (thin player) | S01 | Select/test one Web Audio renderer, tiny app, play/pause A/B, Now/Next and a cue-checked scheduled A→B transition. Browser/offline tests, build instructions and lifecycle limits. |
| **EMF-S03** | **CLOUD** | EMF04/07/12 (thin DJ) | S02 | DJ state/genre/next/queue/Hold requests with explicit queue priority, cancellation, idempotent retries, no-match fallback and deterministic tests. |
| **EMF-S04** | **CLOUD** | EMF04/10 (first recipe) | S01–02 | Procedural sampler/phrase source sharing clock and `prepare/start/exit/release`; original palette, distinct seeded variations, bounded resources and replay tests. |
| **EMF-S05** | **CLOUD** | EMF04/09/11 (handoff) | S03–04 | DJ drives recording A → procedural → different recording B with checked cues, bass/tail handoff and safe fade/bridge; reproducible audio/command tests. |
| **EMF-S06** | **CLOUD** | EMF06/15 (contract only) | S01, S04 | Portable import/manifest validation and mock FL-producer/MCP contract tests. Verify sound enters generator regardless of producer; **no claim of actual FL control**. |
| **EMF-S07** | **CLOUD** | EMF05 cloud scaffold review | S02–06 | Integrated app/demo, CI or repeatable test commands, offline/browser audio checks, review findings and exact artifact/commit SHA. Report **cloud playable proof**, not accepted full MVP. |
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
- **Next now:** S03 CLOUD, with optional S08 PC in parallel. Subsequent implementation slices run when selected; no automatic DAW operations, model downloads, product release or changes to the Mission Control repo are authorized by the slice order.

## Stage map and sole status owner

| Stage | Status | Outcome | Depends on | Exit evidence |
| --- | --- | --- | --- | --- |
| **EMF00** | **COMPLETE — documentation only** | Original documentation/research baseline | Initial owner brief | Baseline `ee7125e` and retained [Progress](../PROGRESS.md) evidence. |
| **EMF01** | IN_PROGRESS — S01/S02 cloud reviews checked | Contract/adequacy review | EMF00 | Bounded [S01](../reviews/EMF_S01_FOUNDATION_REVIEW.md) and [S02](../reviews/EMF_S02_PLAYER_REVIEW.md) reviews cover their implemented cloud boundaries. S02 selects and tests Web Audio; actual FL host capabilities remain S08. |
| **EMF02** | IN_PROGRESS — S01 fixtures checked | Portable fixtures then FL production sources | EMF01 contract | Two original recordings and four sample inputs validated locally. S09 still must verify eligible FL exports through the same pack schema. |
| **EMF03** | IN_PROGRESS — S02 cloud renderer checked | Initial renderer | S01 fixtures | One native Web Audio backend selected; S02 offline rendering and live Chromium checks pass on Windows/macOS/Linux. Real audio-device and listening qualification remains on the reference hosts. |
| **EMF04** | IN_PROGRESS — small S02 player only | Working standalone cloud scaffold | S01–05 | Play A/B, Pause, Now/Next and one authored route work. S03–05 still supply the DJ, procedural source, requests and hybrid transitions. **Not blocked by real FL MCP stage EMF15.** |
| **EMF05** | PLANNED | Scaffold review and owner listening | S07 cloud proof; S09 PC integration | S07 reviews running scaffold and technical audio tests; S10 adds full FL-backed real PC listening and owner acceptance. |
| **EMF06** | PLANNED | Versioned library and importer | EMF05 | Readiness-dependent metadata, hashes, intended-use eligibility, cues and useful errors; no mandatory annotation wall. |
| **EMF07** | PLANNED | Transport and state lifecycle | EMF05–06 | Requested/planned/audible state, musical dwell, bounded wait, hold, duplicate/revision/expiry and restart behavior. |
| **EMF08** | PLANNED | Manual listening app | EMF07 | Simple MC-facing panel plus advanced lab, pending display, skip/favorite, save-vibe and accessible controls. |
| **EMF09** | PLANNED | Recorded transition path | EMF06–08 | Reviewed phrase mix, role substitution and safe fallback, extending the thin proof. |
| **EMF10** | PLANNED | Procedural recipe performer | EMF06–08 | At least three distinct families, palettes and bounded development; selected and held-out seeds heard across supported states. |
| **EMF11** | PLANNED | Hybrid musical handoffs | EMF09–10 | Generalize the small proof within supported content; verify shared context, bass/vocal/tail ownership and latency alignment. |
| **EMF12** | PLANNED | DJ selection and persistent history | EMF11 | Deterministic eligibility/recency/preference rules, fixed-state identity changes, replayable versions/seeds and bounded logs. |
| **EMF13** | PLANNED | Transition graph and coverage | EMF12 | Directed continuation/bridge routes and dead-end/coverage diagnosis, not all-pairs discovery or universal compatibility. |
| **EMF14** | PLANNED — after S10 | Mission Control request adapter | S10, required API refinement | S12 real MC integration only after standalone MVP listening acceptance. |
| **EMF15** | IN_PROGRESS — S08 bounded path verified on Windows | Unified FL Studio MCP authoring control | S01 contract, actual PC environment | [S08](../handoffs/EMF-S08-HANDOFF.md) verified real note/tempo/clip edits, FL-side readback, save, CLI render, export checks, reconcile and recovery through one facade for Claude Code and Codex. Live GUI control, mixer/plugins, render settings and non-Windows FL remain open; S09 imports outputs. |
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
| EMF-C04 | Recorded/procedural/recorded handoffs and at least one non-direct bridge | Pending |
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

**S02 COMPLETE**, 2026-11-04, for the assigned small-player engineering boundary. Intake main was `43b7f449c0370f22c75463b278b3f50c09a0ee0d`. Tested implementation/corrections: [`c7f75321bf034517fd0b2fde41298285b89f26b9`](https://github.com/splatter85/EUTONOS-Music/commit/c7f75321bf034517fd0b2fde41298285b89f26b9), tree `433493c05ee4d04fa5705cd82a094ff2dc5204c9`, published/read back on the S02 branch. The final closeout integrates this unchanged tested source with documentation/evidence; its containing commit is identified in the checked chat handoff.

`npm ci --ignore-scripts` and `npm run check` passed **54 tests, zero skipped**, exact regeneration of all seven fixture files and validation of all six WAVs. [Run 41903543079](https://github.com/splatter85/EUTONOS-Music/actions/runs/41903543079) passed on **Windows, macOS and Linux**, including seven native offline Web Audio checks and live Chromium transport/ownership/reload/layout checks. The actual A→B source was rendered and compared sample-by-sample at 48 kHz and 44.1 kHz. Cue boundaries remain exact; native 44.1 kHz EOF rounding is reported separately. The [S02 handoff](../handoffs/EMF-S02-HANDOFF.md) and [retained evidence](../evidence/emf-s02/README.md) contain versions, measurements, historical failures/corrections, source review and limitations. Physical speaker/headphone output and listening were **not tested**. No full DJ, live procedural player, FL/MCP or MC integration is claimed.

S01's original contracts and fixtures are unchanged; its [historical handoff](../handoffs/EMF-S01-HANDOFF.md) remains applicable. **Next: EMF-S03 — CLOUD**, integrating the deterministic DJ and S01 state/genre/Next/queue/Hold contract with this player. First inspect current main/worktree and run the Node 24 checks. **PC S08 is complete** (see the S08 checkpoint below); cloud S03–S07 do not wait for installed FL Studio. S09 later joins the paths; S10 still requires owner listening before S12 MC integration. The sequence is unchanged. Overall effort remains unknown; stage counts are not completion estimates.

### EMF-S08 PC checkpoint

**S08 COMPLETE**, 2026-11-04, PC lane, from main `25c26bf9d5c6d0c2352dc0ee8ebfe2ff958978ec`. Claude Code wrote an original 8-bar, 120 BPM A-minor sketch (chords, bass, lead, drums; 221 notes) through the `eutonos-music` MCP facade into a disposable copy of an FL factory template. FL Studio 26.1.7 loaded the saved project and its MIDI export matched every note and the tempo; the FL CLI render (PCM16 stereo 44.1 kHz, 19.98 s) passed export checks; the pack validated with the unchanged S01 loader. Codex used the same facade, was refused while Claude held the writer lease, then made a bounded verified edit. Live refusals and recovery and simulated failure cases are listed in the [S08 handoff](../handoffs/EMF-S08-HANDOFF.md). `npm run check` passed 66 tests. Renders and packs stay owner-local (factory-instrument rights); **nobody has listened**. This does not change the cloud sequence: **next remains EMF-S03 — CLOUD**.

## Resume and closeout

Inspect branch/HEAD/working changes and preserve unrelated work. Read the current goal, first-playable contract and selected stage. Verify old evidence at its original version and assess current applicability separately. Record the assigned scope and next check before substantive work. Reconcile uncertain side effects before retrying; do not invent operation identities.

At a meaningful checkpoint report practical outcome, checks/limits, position in the current milestone/stage map, effort with basis or unknown, plan assessment, instruction changes and the next concrete step. Keep native filing, Git publication/integration, installation, runtime qualification and owner acceptance separate. Actual listening—not model size or reasoning effort—determines musical acceptance.
