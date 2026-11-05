# Progress and evidence

Document ID: `EM-D014`  
Checkpoint: documentation baseline, 2026-11-03, America/Chicago.

## Delivered scope

The repository now has a product goal, explicit requirements, proposed features/capabilities, architecture, music-library/transition design, external state contract, test-app specification, FL Studio/MCP research, vocal/model assessment, detailed production guidebook, illustrative contracts, and an initial infrastructure campaign.

The baseline contains 36 files: 30 Markdown documents, five illustrative JSON files and a repository ignore file. The guidebook contains seven substantive guides, approximately 22,700 words. Its genre guide covers 24 study families with ingredients, multiple directions, variation rules, failure examples and acceptance exercises. These are educational starting points, not 24 implemented genre engines or an exhaustive account of all musical traditions.

[Current Tasks](CURRENT_TASKS.md) points to [EMF](campaigns/EMF_INITIAL_INFRASTRUCTURE.md). Only EMF00's documentation scope is complete. EMF01–EMF19 and all runtime completion criteria remain planned/pending. The next pickup is EMF01 when implementation work is selected.

## Design review

Independent review identified and resolved these material contract gaps:

- One audible session must own an output device, including auditions; transfer and resumption are explicit.
- A caller can reconcile a lost acknowledgment using its original command identity. Duplicate lookup precedes stale revision/lease/expiry checks, without redispatching prior work.
- Pending-intent expiry and control leases are separate. Audible dwell begins when the new identity is actually heard.
- Recorded/procedural handoffs need source-frame mapping and path latency/padding compensation; scheduling alignment does not imply waveform phase coherence.
- Transition reachability is directed and includes movement within a source section, not merely links between filenames.

The revised architecture, control contract, library design, campaign boundaries and validation scope received a bounded follow-up review with no remaining material blocker in that reviewed scope. This is a documentation review; it does not satisfy the campaign's environment-aware adequacy review or either later implementation review.

Music-guide peer review checked worked chord/interval examples, bar and motif arithmetic, arrangement totals, and stem-recombination explanations. It led to clarifications about half-tempo notation and when a dry bass render must recreate a reference's sidechain behavior. The FL bridge contract also received a lost-acknowledgment correction using its caller-known session/idempotency key.

## Documentation validation

Final local checks are recorded before publication:

| Check | Result |
| --- | --- |
| Local Markdown links and section anchors | Passed: 158 local links, including the linked section anchor, resolve against this file set. |
| Markdown fences and source-reference definitions | Passed: eight fenced blocks close correctly; 54 source-reference uses have definitions. |
| Standalone JSON and embedded JSON/YAML syntax | Passed: five JSON files, three embedded JSON blocks and one embedded YAML block parse. |
| Example identity, musical timing and fictional status | Passed: cross-file identities, eight-bar harmony/transition arithmetic and ineligible/unimplemented status agree; independent review found no material contradiction. |
| Campaign stage/check IDs and guide family numbering | Passed: EMF00–EMF19, EMF-C01–EMF-C12 and genre families 01–24 form the intended sequences. |
| Public-repository content review | Passed for this documentation bundle: no private project text, workstation paths, credentials, proprietary media or model files included. |

The published commit containing this record is the versioned checkpoint. The delivery handoff records the observed default-branch commit and the comparison of its remote file tree with the reviewed local files; merely creating a commit object is not branch publication. Documentation checks establish syntax/navigation and the stated consistency properties, not runtime behavior or musical quality.

## Evidence limits

No player, procedural renderer, DJ, FL Studio adapter, model worker or test app has been implemented or run in this baseline. No model or plugin was installed. No music, voice or instrument was generated, rendered or auditioned. No performance figure, compatibility result, seamless-transition result or three-day variety claim is established.

Primary-source research and selected community source inspection support the stated candidate capabilities. They do not establish the owner's installed FL version, local hardware behavior, final dependency selection, asset rights for a future distribution or musical acceptance.

The public files contain original planning/educational text and fictional data. No proprietary sound content, voice bank, model weight, credential or private project material is included. Project licensing remains an explicit open decision; candidate dependency terms are recorded separately.

## Resume

Read [AGENTS.md](../AGENTS.md), [Current Tasks](CURRENT_TASKS.md), the EMF campaign and the documents attached to the selected stage. Recheck the actual repository and workstation before converting proposals into implementation claims. Preserve this checkpoint as historical evidence and record later delivered behavior in a new entry.


## 2026-11-03 — Mission Control-first scrutiny and sequence revision

Review input: `ee7125e95a0e73a3e6616e7832602b63778e2b03`. The earlier sections above are the original baseline record, preserved byte-for-byte; they are historical evidence, not tests rerun during this review.

The owner clarified that MC music is the first product while larger opportunity remains possible. [EM-REVIEW-001](reviews/MISSION_CONTROL_FIRST_REVIEW.md) answers forty questions, labels the missing prior-question reconstruction honestly and retains ten design strengths. [First playable](FIRST_PLAYABLE.md) now defines the thin audible proof and useful MC pilot. Canonical goals, architecture, delivery, catalogues, UI, validation, decisions, instructions and current campaign/queue reflect that sequence.

The change is dependency order and acceptance focus, not removal of the FL MCP bridge, vocals, local models or broad library. EMF00–EMF19, EMF-C01–C12 and requirement/feature/capability IDs are retained. EMF01–EMF19 remain planned; all runtime checks remain pending. A single-assistant documentation review does not satisfy an independent or environment-aware implementation gate.

Validation for this revision: passed for the 16 changed/new Markdown files: 119 relative links resolve against the pinned baseline path inventory plus the candidate files; the one changed-file fenced block closes; source-reference definitions resolve; all 40 numbered answers and ten strengths are present; 14 requirements, 16 features, 12 capabilities, 20 stage IDs and 12 campaign check IDs are retained; no future runtime stage/check was marked complete. The original Progress prefix matches its source-pinned Git blob exactly. Manual consistency review checked pilot-versus-full-campaign scope, listener priority, renderer qualification and retained authoring work. Unchanged guides/examples were not re-tested in this turn. No independent reviewer was available for this revision.

The commit containing this entry is the source checkpoint. Final handback reports only publication/readback actually observed. No runtime code, audio, assets, model/plugin installation, FL operation, actual MC connection or listening result was produced. No separate repository or workstation was changed. Next implementation pickup remains EMF01 with the small audible proof as its target; overall implementation effort is unknown.

## Standalone MVP direction, 2026-11-03

Owner narrowed the first build to a working Visual Basic AI/FL Studio controller, procedural generator, DJ and tiny standalone test app. Mission Control integration now follows verified standalone success. Historic research/stages are preserved. **Planning change only**; no executable music or listening qualification exists yet.

## Agent authoring interface correction — 2026-11-03

The owner clarified that Codex and Claude need comprehensive FL Studio authoring control. The design moves from provisional VB.NET-first to **one MCP server with multiple validated FL scripting, UI and rendering adapters**; VB.NET remains an optional UI. [Unified control design](FL_AGENT_CONTROL.md) records current community options, capability limits and a safe staged test path. This is **documentation only**, not a tested MCP installation, working DAW edit, export or audible MVP.

## 2026-11-04 — cloud-first slicing (planning only)

The one existing EMF campaign now contains ordered execution slices EMF-S01–S13 tagged CLOUD, PC or BOTH. Cloud S01–S07 can build DJ/requests/procedural app and tests with original fixture assets. Real FL Studio/MCP editing/export on PC starts at S08 any time after S01 and can run in parallel; S09 integrates cloud code with actual FL-made sounds, and S10 is the owner listening gate before S12 Mission Control. Existing EMF00–EMF19 stage identities and full campaign checks are retained. **No runtime, FL edit or listening outcome is claimed from this documentation work.**

## 2026-11-04 — every-slice handoff policy and first pickup

The owner selected a **two-part handoff for each EMF execution slice**: a detailed, checked, published `docs/handoffs/EMF-Sxx-HANDOFF.md` plus a mini copy-ready handoff given in the completing agent's chat message. The [Work Model](WORK_MODEL.md#per-slice-handoff-policy) owns this policy; [handoff folder](handoffs/README.md) contains the template and an [EMF-S01 pickup brief](handoffs/EMF-S01-PICKUP.md). The campaign remains the sole slice status owner. **S01 remains unstarted; no implementation code, audio or tests were delivered by preparing this pickup.**

## 2026-11-04 — S01 portable foundation

Implementation source: [`8aad03c882fdff0ae900edb7045cc28138aea0ae`](https://github.com/splatter85/EUTONOS-Music/commit/8aad03c882fdff0ae900edb7045cc28138aea0ae), based on intake `10987524f3ad7b4f6434c2df7c571346f08a08bc`. Its published Git tree `fde149879bbbbaed95dc9f9e7366700d2ad02c68` matches the reviewed local code/data tree. Earlier progress entries above remain historical snapshots.

S01 delivers `em.audio-pack.v0`, the common source lifecycle, typed local request/queue contract, original PCM16 recording A/B plus four sample inputs, deterministic fixture construction and validation. The owner added **Windows/macOS/Linux** as targets, with Windows allowed to lead real FL work; canonical requirements and the CI matrix now reflect that direction.

Local `npm run check` passed **28/28 tests**, deterministic comparison of six WAVs plus the manifest, and all media/rights-evidence validation. Independent FFmpeg 7.1.5 decoding passed for all six files. The [bounded independent review](reviews/EMF_S01_FOUNDATION_REVIEW.md) retained the implementation after addressing harmony semantics, a receipt cap that could block Stop/Mute, Hold policy and clock-frame units. GitHub [run 41891295002](https://github.com/splatter85/EUTONOS-Music/actions/runs/41891295002) completed successfully on **Linux, Windows and macOS**, with 28 tests and the identical fixture/validation checks on each. The closeout is documentation only; tested code/data and workflow are unchanged.

The [detailed S01 handoff](handoffs/EMF-S01-HANDOFF.md) carries exact versions, commands, hashes, publication evidence, limitations and the S02 CLOUD pickup. Real audio output/listening, browser playback, full DJ/generator, FL/MCP and Mission Control are not verified or implemented by this slice. The full campaign remains in progress; effort percentage is unknown. After verified S01 closeout the owner can start S08 PC in parallel with cloud S02–S07.


## 2026-11-04 — S02 small Web Audio player

Tested source/corrections: [`c7f75321bf034517fd0b2fde41298285b89f26b9`](https://github.com/splatter85/EUTONOS-Music/commit/c7f75321bf034517fd0b2fde41298285b89f26b9), tree `433493c05ee4d04fa5705cd82a094ff2dc5204c9`, from clean S01 main `43b7f449c0370f22c75463b278b3f50c09a0ee0d`. The remote branch and local source tree were compared exactly. Earlier Progress entries remain unchanged historical records.

S02 implements one native Web Audio recording player, Play/Pause A/B, Stop, Volume/Mute, clock-derived Now/Next and the checked fixture A→B transition. Native starts/fades/stops use one audio clock; async generation guards preserve listener actions. A portable loopback server, cooperating same-origin tab lock, offline check page and reproducible browser runner accompany it. The S01 contracts, two original recordings, four samples, generator and provenance remain unchanged.

Local checks passed **54/54 Node tests, zero skipped**, byte-identical regeneration of seven fixture files and validation of all six WAVs. [Hosted run 41903543079](https://github.com/splatter85/EUTONOS-Music/actions/runs/41903543079) passed the same checks on **Windows, macOS and Linux**, plus seven native offline checks and live Chromium transport/ownership/reload/layout checks on each. Native A→B output was compared sample-by-sample at 48 kHz and 44.1 kHz; cancelled future audio rendered silence, and a pickup/nonzero-entry diagnostic landed at its exact expected frame. [Retained raw evidence](evidence/emf-s02/README.md) preserves the reports and inspected desktop/mobile screenshots.

Bounded review and execution corrected ownership-failure cleanup, a Windows child-process teardown order, and an overly strict natural-EOF assertion at 44.1 kHz. The latter now reports the decoder's already-allowed one-frame length rounding; exact entry/handoff frames and the original sample-error tolerance remain unchanged. The [source review](reviews/EMF_S02_PLAYER_REVIEW.md) preserves its historical pins and evidence limits; the [detailed S02 handoff](handoffs/EMF-S02-HANDOFF.md) records the completed gate, commands, publication/readback route and recovery limits. The final closeout adds only documentation/evidence to the tested source.

**Physical audio output and human listening were not tested.** Full DJ, live procedural performance, actual FL/MCP and Mission Control remain later slices. The campaign remains in progress with effort percentage unknown. Primary next pickup is **S03 CLOUD**; **S08 PC may proceed independently** using the unchanged S01 contract. No later slice was implemented by this closeout.

## 2026-11-04 — S08 FL Studio authoring through one MCP facade (PC)

From main `25c26bf9d5c6d0c2352dc0ee8ebfe2ff958978ec` on the owner's Windows PC with FL Studio 26.1.7.5654. A dependency-free stdio MCP server (`src/authoring/`) gives Claude Code and Codex the same 16 tools over one broker and private workspace. Claude Code created a disposable project from an FL factory template, wrote an original 8-bar A-minor sketch (221 notes, 120 BPM), and FL itself confirmed every note and the tempo through its MIDI export. FL's CLI rendered the WAV, which passed export checks and became a valid `em.audio-pack.v0` pack. Codex connected through the repository's `.codex/config.toml`, hit the writer lease, then made a bounded verified edit. An independent code review's 15 CHANGE items were fixed and re-checked live. `npm run check`: 66 tests pass. Audio stays owner-local; nobody has listened. [Handoff](handoffs/EMF-S08-HANDOFF.md), [guide](S08_FL_AUTHORING.md), [evidence](evidence/emf-s08/README.md).

## 2026-11-04 — S03 deterministic DJ and request integration

Intake: clean main `cd5e5255fc0d3fb4d48500f4541cce1e55e984aa`, the owner-specified S08-containing commit, with its 66-test baseline passing. Final tested source: [`71d954534087ff1637b8ff0e8fc51c393a89abfa`](https://github.com/splatter85/EUTONOS-Music/commit/71d954534087ff1637b8ff0e8fc51c393a89abfa), tree `2eba5fc6ccfb4b3f475ef92512a37436656f1623`. Published source was fetched back and compared with the local committed tree. All earlier Progress content remains the unchanged historical prefix.

S03 connects the in-process request contract to the existing one-clock renderer: deterministic state/genre/Next selection, manual FIFO priority, Hold, queue/future-plan cancellation, effect-idempotent retries and visible no-match/blocked fallback. Before B starts, cancellation restores full A and removes B; a started mix finishes unless explicitly stopped. Queue entries are consumed at renderer-clock entry, including delayed promise observation and mute. Requested targets, prepared schedules and renderer-active sources stay separate. UI controls all use the coordinator. There are still only two supported recordings, one A→B route and no automatic queue drain or invented loop.

The assembled local suite passed **101/101 tests, zero skipped**, byte-identical regeneration of seven fixture files and validation of six WAVs. [Hosted run 41925003036](https://github.com/splatter85/EUTONOS-Music/actions/runs/41925003036) passed these checks on **Windows, macOS and Linux**, plus nine native offline audio checks and all ten browser report groups (one summarizes the offline checks; nine cover the actual S03 UI). Native cancellation matched full-length A with **zero measured maximum sample error** at both 48 kHz and 44.1 kHz on every OS. The original `0.000003` tolerance and exact cue assertions remain unchanged. [Retained reports/screenshots/provenance](evidence/emf-s03/README.md) preserve the evidence beyond hosted artifact expiry.

The [bounded independent source review](reviews/EMF_S03_DJ_REVIEW.md) retained the core after corrections for cancellation during initial decode, target rebinding/supersession, FIFO result identity and native schedule observation races. Seven independent call-recorder tests and a focused boundary regression passed. A later browser-harness failure came from reading rendered text inside a collapsed disclosure; using DOM text fixed the assertion without weakening suspended-clock checks. The final assembled native run is green. The local runtime's Chromium socket restriction was respected; hosted CI supplied actual browser execution. The final documentation/evidence closeout does not alter the tested runtime, tests, assets, dependency lock or workflow.

The [S03 handoff](handoffs/EMF-S03-HANDOFF.md) records exact versions, source applicability, corrections, recovery and the next pickup. S08's previously queued Windows job is now successful as well ([run 41909105766](https://github.com/splatter85/EUTONOS-Music/actions/runs/41909105766)); no live FL actions were repeated. The S01 audio/provenance and S08 facade/configuration are unchanged, and private PC renders remain local and unauditioned.

**Physical output and human listening were not tested.** Procedural performance, joined FL/cloud playback, full standalone acceptance and Mission Control remain open. The campaign remains in progress with effort percentage unknown; its sequence is unchanged. **Next: EMF-S04 — CLOUD**, the original-palette sampler/phrase source sharing the common lifecycle, with bounded seeded variation/replay tests. The owner still approves the project MCP server once in interactive Claude Code, independently of cloud S04. This closeout does not start S04 or change the PC.


## 2026-11-04 - S04 procedural candidate; publication/native gate blocked

Intake and last remote main readback: `66e974c9abbebc6ea9e3aaa6bf55dbd053d8a5bb`, the owner-specified S03-containing revision. Local implementation commit: `d921382ba948b5bad370751c90b39fb695888058`, tree `a28ff92757aa7c03f479ef4f5921290cfb148008`, on `work/emf-s04-procedural-20261104`. These are local pins, not published GitHub revisions. All earlier Progress content remains byte-identical historical context.

S04 implements one immutable seeded eight-bar performer over the original four-sample palette, a native-buffer source on the existing clock/lifecycle, and a separate audition through the shared player. Explore/Drive change bounded rhythm and arrangement; explicit seed/state plus performer/pack/palette/sample identity supports symbolic replay. The source bounds scheduled notes, actual simultaneous intervals and decoded sample values. One pending/resolved palette decode survives Stop for replay, with per-intent rights/metadata validation; disposal drops player references. This remains a finite audition/replacement source, not the S05 overlapping recorded/procedural route. The original recordings, samples, fixtures/provenance, dependencies and S08 facade are unchanged.

Node 24.22.1 setup and the 101-test baseline passed. The final local `npm run check` passed **127/127 tests, zero failed/skipped**, seven byte-identical regenerated fixture files and six WAV validations. Phrase tests cover 560 seed/state bounds combinations and pinned replay digests. Independent review found a multiplied pending-decode resource issue, corrected to one shared decode job. Its six regressions are included in the final assembled run; the reviewer's earlier focused invocation passed 17 tests before the final role-stream/end-rounding changes. The reviewer then inspected final source and log. Authored note endpoints now use integer native-sample frame arithmetic; no sample-comparison tolerance was widened. [Review](reviews/EMF_S04_PROCEDURAL_REVIEW.md), [raw local evidence](evidence/emf-s04/README.md).

Six new native offline groups and a sampler browser flow are written and compiled, retaining prior S03 coverage, but **NOT RUN**. Local Chromium could not create its required socket; the connected-browser context was unavailable; a permitted cloud browser could not reach the loopback server. No S04 native audio, screenshot or three-OS CI result exists. **Physical output and human listening were not tested.** Historical S03/S08 green results retain their original applicability and do not establish S04 behavior.

The attempted shell operation committed the implementation locally, then automatic approval review rejected the push to the public repository because explicit authorization to publish the new S04 source/test/workflow/documentation payload was required. Read-only remote inspection confirmed unchanged main and no S04 branch. No alternate write API was used. The [blocked handoff](handoffs/EMF-S04-HANDOFF.md), campaign and Current Tasks preserve the concrete recovery route; this closeout changes only documentation/evidence. Publication/readback of that closeout and integration into main are still undone.

**Next: resume EMF-S04 - CLOUD**, inspect local/remote state and verify explicit publication/integration approval, then publish/read back the candidate and run the existing Windows/macOS/Linux native/browser checks. Complete evidence-backed closeout before advancing to S05. S08's one-time interactive Claude Code project MCP approval remains a separate PC owner action; no PC or Mission Control work was performed. The campaign remains in progress, S04 is blocked at delivery/native verification, and effort percentage is unknown.


## 2026-11-04 — S04 branch publication, native replay correction and completion

The owner subsequently authorized publication of S04 on a separate branch and explicitly excluded main. The original blocked entry above remains byte-identical historical evidence. Main stays at `66e974c9abbebc6ea9e3aaa6bf55dbd053d8a5bb`; its intentional lack of S04 is not a delivery blocker. Command-line Git lacked a login, so the connected GitHub app published the authorized work on `work/emf-s04-procedural-20261104`. Published initial source `d2ae7e9e8c6a56ead6b28b4e249c5f2b99128abf` and checkpoint `9f89e1ed9459260c228f8ed4cc22bed089bb55b6` exactly match the original local implementation and closeout trees; readback succeeded.

Initial [run 41959790896](https://github.com/splatter85/EUTONOS-Music/actions/runs/41959790896) passed 127 Node tests and 13 of 15 native groups on all three OSes, but strict same-seed replay failed at 48/44.1 kHz and blocked the UI flow. Diagnostic source `9e087fa8a140048e014ad7d4d215a9ac68e0856c` and [run 41960453351](https://github.com/splatter85/EUTONOS-Music/actions/runs/41960453351) retained exact replay and the original `0.000003` oracle tolerance. Plans and decoded samples were identical; tiny output differences appeared only with three/four overlapping nonzero contributors. This supports a summation-grouping issue without asserting a specific browser internal mechanism.

The correction uses two bounded unity-gain buses (drum/percussion and bass/harmony) before the existing master, with immediate registration inside the gated scheduling transaction and cleanup on failure/release/completion. Native-frame bounds permit at most one active note per role. Two source regressions and an independent bus-connection-failure case retain cleanup guarantees. The independent reviewer built and ran **18 focused player/reviewer cases**, all passing. The complete local `npm run check` passed **130 tests**, seven byte-identical fixture files and six WAV validations.

Corrected published runtime/test source **`73c456a147dcf24161ce22187e5e62320c5141b5`** and local `f4c804075db713918ddf7a09a3a4f622b7e930c1` share exact tree **`92362e7d5dd6552c0255ae0e9220115d104fe052`**. [Run 41961109555](https://github.com/splatter85/EUTONOS-Music/actions/runs/41961109555) passed **130 Node tests, 15 native audio groups and 11 browser report groups on Windows, macOS and Linux**. Same-seed native output is bitwise exact with zero differing samples/bit patterns and zero maximum delta at both rates. The maximum S04 independent-oracle error was `1.598351953291388e-7`, below unchanged tolerance. Every render released all live note/mix nodes. All original S03 flow checks and the new sampler flow passed.

[Retained evidence](evidence/emf-s04/README.md) preserves original failures, diagnostic reports and final reports/screenshots with source/run pins and verified artifact digests. Desktop/mobile screenshots were inspected on all three OSes. The [review](reviews/EMF_S04_PROCEDURAL_REVIEW.md), [detailed handoff](handoffs/EMF-S04-HANDOFF.md), campaign and Current Tasks now record **S04 COMPLETE for its assigned cloud engineering scope on the separate branch**. This final closeout changes documentation/evidence only; runtime/tests, original fixtures/provenance, dependencies, workflow and S08 facade are unchanged from the tested source.

**Physical output and human listening remain NOT TESTED.** No PC pull or owner action is needed to finish S04. The S08 one-time interactive Claude Code project MCP approval remains separate; S09 joins real FL content and S10 supplies listening acceptance. The overall campaign remains in progress, effort unknown. **Next: S05 — CLOUD**, when separately assigned, starting from the verified S04 branch for recorded → procedural → recorded handoffs. Main was not merged or updated and no later slice was implemented.
