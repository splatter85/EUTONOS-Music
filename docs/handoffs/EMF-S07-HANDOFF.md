# EMF-S07 — integrated demo, review and handoff

**Campaign:** EMF / `campaign-emf-001`  
**Slice:** EMF-S07  
**Disposition:** **COMPLETE** for the bounded demo scope; reviewed and integrated into main by the coordinator  
**Environment:** owner-selected PC execution, Windows 11 only  
**Base:** main `7f86dbb2aa19016348b082c4f9058f237aed17e4`, clean at pickup  
**Branch:** `work/emf-s07-app-20261106`  
**Tested source:** worker `0cec058b8f8b4d9b5f6a8ddf5c1a5fd01139fd11`; corrected after coordinator review **`9cc24e74d74ef9e2a3022e5dd5ca02737a42df4d`**  
**Recorded:** 2026-11-06

## Assignment and bounded result

The owner assigned integrated app/demo, repeatable commands, offline/browser audio checks, scaffold review findings and an exact tested SHA. This is **playable engineering proof on Windows, not an accepted MVP**. The coordinator is responsible for independent review/checks, integration and publication; the worker must not merge main or run EUTONOS CLIs/native updates. The [campaign](../campaigns/EMF_INITIAL_INFRASTRUCTURE.md) owns live status. The [S07 guide](../S07_APP.md) gives the runnable path.

Inspection of S02–S06 showed a working DJ/hybrid bound to the S01 route and a working generic performer whose imported mock palette was reachable only through checks/API/CLI. The smallest coherent result is **two linked demo surfaces using the existing player**: S01 DJ/bridge, and sampler with S01 original / S06 imported mock palette comparison. Generalizing imported-recording DJ/hybrid selection remains S09. This does not create a second DJ, new renderer, library service or speculative production pipeline.

## Delivered changes

| Area | Result |
| --- | --- |
| `web/index.html` | Demo navigation, ordinary entry to imported mock-palette playback, accurate S01 DJ/bridge and qualification limits. |
| `web/procedural.html`, `web/procedural.ts` | A two-choice built-in palette selector and `?pack=mock-fl` entry; exact selected recipe/route references; silent plan preparation; explicit Play; Stop required before changing an active/paused performance; disposal of the old context; retained volume/mute; refresh preserves choice without autoplay; restored-page loads revalidate. |
| Existing playback contracts | `compilePhrase`, `SmallPlayer`, bounded pack loading and same-origin Web Lock reused. One owning AudioContext schedules sound. Requested/selected plan, prepared metadata and renderer-active Now remain distinct. The renderer, DJ, hybrid policy, importer and schemas are unchanged. |
| `scripts/browser-check.ts` | Three added browser groups and `artifacts/s07-browser/` output. Actual context instrumentation verifies zero contexts during selection and closure of the old context after switching. Existing native/transport/DJ/hybrid checks retained. |
| `scripts/serve.ts`, `web/style.css` | Corrected demo startup label and small wrapping navigation style. No expanded server routes or dependencies. |
| Canonical docs | Guide, this detailed handoff, campaign/checkpoint, Current Tasks, Progress, README, AGENTS and affected demo/validation/map descriptions updated for built-on-branch status. |

No audio, dependencies, credentials or private production material were added. S01 fixture hashes/bytes are unchanged. The [original S01 provenance](../../fixtures/s01/PROVENANCE.md) and [S06 mock producer](../S06_IMPORT.md#the-mock-fl-producer) remain the asset sources. The original CC0 mock material is generated beneath ignored `dist/generated/s06-mock-fl/`; it is fixture-only and not listening-reviewed. The generator exercises the existing in-process broker/mock host; **no FL Studio or music-authoring MCP tool was called**.

## Exact verification

Both required gates ran successfully with **HEAD at tested source `0cec058b8f8b4d9b5f6a8ddf5c1a5fd01139fd11`**. Subsequent changes are documentation only. No source/test/media change follows that pin.

Runtime: **Windows 11, Node 26.12.1, Playwright 1.62.1, headless Chromium 151.0.7922.34**. The package declares Node 24; Node 24 was unavailable and was not installed. Existing dependencies and browser were reused; no `npm ci`, package/browser download or installation was needed. PowerShell refused `npm.ps1`, so commands used the ordinary `npm.cmd` launcher without a policy change.

| Exact command / observation | Result | Evidence and limits |
| --- | --- | --- |
| `npm.cmd run build` | PASS | TypeScript compile during implementation; repeated only as part of required gates. |
| `npm.cmd run check` | PASS | **161 Node tests**, 161 pass, zero fail/cancelled/skipped; seven deterministic fixture files match generator v1, seed `0x454d4601`; six committed WAV files pass metadata/hash checks. Node tests unchanged; new user-flow regressions belong in the existing browser runner. |
| `npm.cmd run check:browser` | PASS | **23 native offline groups, 15 browser report groups**, all PASS, no page script errors. Final browser run: **44,017 ms**. Includes the native summary plus 14 UI groups. |
| Native offline audio | PASS | Existing nine recorded-source, six procedural, four S05 hybrid and four S06 imported-producer groups. Existing sample tolerances, stereo comparisons and strict same-seed replay were not relaxed. |
| Three S07 browser groups | PASS | Main-page imported entry; silent plan/zero-context selection; same-seed event-count comparison; imported transport/pause/mute; paused/running selector guard; old-context closure; lock conflict and explicit transfer; navigation cleanup; missing/corrupt/unknown selection; recovery/refresh; mobile fit. |
| Screenshots | Inspected | Desktop DJ and mobile original/imported sampler outputs; no horizontal overflow at 390 px. Numerical layout assertions and screenshots are engineering evidence, not listener judgment. |
| Relative Markdown links / `git diff --check` | PASS at closeout | **71 Markdown files, 544 relative links and 16 section anchors**, zero unresolved targets. Current Tasks RAM fence unchanged from base. |
| macOS / Linux / Node 24 | NOT RUN | Windows-only evidence; historical S04 results do not qualify S07 on another platform. |
| Physical output / human listening | **NOT TESTED** | Headless live scheduling and OfflineAudioContext rendering establish neither device output nor music quality. |
| Real FL / real FL import / owner acceptance | NOT RUN | Out of this worker scope. S09 joins content; S10 supplies listening acceptance. |

Full final command output is retained locally in ignored `artifacts/s07-browser/node-check.log` and `browser-check.log`, with `browser.json`, `offline.json` and screenshots. These artifacts are local, not committed/hosted reports. The runner closes its browser/server in `finally`; no demo server is left running. A Chromium diagnostic log emitted in the working directory during headless runs was moved into the artifact folder; it contains audio-pipe closure warnings, not proof of physical output.

**Audio rendered: yes, offline and headless scheduling. Played on physical output: NOT TESTED. Auditioned by a listener: NOT TESTED. FL Studio involved: no.**

## Scaffold self-review and disposition

This is a **self-review**, not an independent review or EMF05 listening approval. Reviewed the complete diff from base, its callers, pack loading, recipe/route binding, transport/ownership/lifecycle, server exposure, failure recovery, tests and doc links. **KEEP for this bounded engineering scope after the fixes below.** Coordinator review remains pending.

| Finding | Evidence / fix / disposition |
| --- | --- |
| **Medium, corrected:** a first UI candidate selected imported bytes but still called `compileS01Phrase`, whose default names `s01-recipe@1`. | The initial browser run stopped in the added imported-entry group with `compatibility: the pack has no recipe s01-recipe@1`. Changed the page to existing `compilePhrase` with the selected pack's exact recipe reference; removed the hard-coded player route. Imported UI/native checks pass at the tested source. No performer or DJ generalization was needed. |
| **Low, corrected by inspection:** leaving during an asynchronous pack load invalidates the old result; restoring that page could leave its picker waiting. | Load epochs reject stale results, and persisted `pageshow` revalidates selection silently. Actual OS sleep, device loss and browser back/forward-cache qualification remain unrun; the navigation/reload behavior exercised by the runner passes. |
| **Low, corrected:** current demo copy described the bridge as future work and imported material as checks-only. | Updated the normal UI, entry/status docs and guide to distinguish the existing S01 bridge, ordinary imported sampler and S09 imported DJ work. Old slice handoffs remain historical. |
| **KEEP:** one renderer/clock/owner, bounded validated fixture loads and separated prepared/active state. | Existing implementation reused. Browser assertions cover zero AudioContexts before Play, closure on stopped palette switch and shared-owner refusal/transfer. No parallel audio implementation or new runtime package. |
| **DEFER:** arbitrary imported-recording DJ/hybrid routing, background playback, durable library/history, real FL content and full listening acceptance. | These require their existing later slice/qualification scopes; they are not claimed by linked demo navigation or test counts. |

An intermediate corrected candidate passed the browser gate before final context-disposal assertions and restored-page handling were committed. Both full gates were then rerun on the exact tested source above. The earlier failed candidate is not delivery evidence. No unresolved source defect was found within the selected scope; independent review and platform/device limits remain open.

## Coordinator review and corrections

A separate read-only agent reviewed `7f86dbb..e4bfbfb` and probed the phrase compiler against both bundled manifests; the full record is the [S07 review](../reviews/EMF_S07_APP_REVIEW.md). Disposition: **KEEP for the bounded demo scope after corrections.** No high finding.

| Finding | Correction |
| --- | --- |
| **Low–medium:** a stale palette selection could resume after a newer one following a back/forward-cache restore during a pending close. | Epoch rechecked right after the old player closes. |
| **Low:** a failed load left an option selected, so the same palette could not be retried; `?pack=unknown` persisted. | The picker clears after a failure and an unknown value leaves the URL. |
| **Low (accessibility):** the status line kept "Loading palette…" after a failure and did not name the ready palette. | Failure and palette-specific ready text; intro text is a polite live region. |
| **Low:** an AudioContext would leak per Play if the route check threw. | The context is closed on constructor failure. |
| **Low (tests/wording):** palette comparison asserted only the event count; restore handling was stated as fact; the demo link said "Play". | Palette-specific assertions added; restore marked "by inspection only"; link and server wording corrected. |

At the corrected source **`9cc24e74d74ef9e2a3022e5dd5ca02737a42df4d`**, Windows 11, Node 26.12.1, Chromium 151.0.7922.34, Playwright 1.62.1: `npm.cmd run check` passed **161/161 Node tests**, fixture regeneration and six media validations; `npm.cmd run check:browser` passed **23/23 native offline groups and 15/15 browser report groups** with no page script errors (44.6 s). macOS/Linux and Node 24 were not run. **Physical output and listening are NOT TESTED. No FL Studio ran.**

## Git delivery, controls and recovery

- The worker built on **`work/emf-s07-app-20261106`** and did not merge main. The coordinator reviewed the branch, committed the review corrections there and fast-forwarded main to it; the integrated main SHA is given in the coordinator's mini handoff and the RAM record. Worker commits end with the worker's own co-author line.
- The worker's optional `git push -u origin work/emf-s07-app-20261106` was rejected by its automatic approval review; it did not retry. The coordinator published main by a plain fast-forward push; the work branch itself was not pushed.
- The tested source pin above identifies the executable source; the worker handback supplies the containing final docs SHA. A file cannot name its own containing SHA. Compare source paths against that pin before relying on the evidence.
- The worker changed none of `docs/WORK_ITEMS.md`, `NAV/`, `RAM/`, `eutonos.*.json`, `.claude/`, `.codex/` or external configuration. The coordinator then updated the board, NAV, RAM and acceptance through the EUTONOS CLIs. The single Current Tasks `tokenslang-ram-links` fence is preserved.
- Campaign, Current Tasks and related readable docs record **S07 COMPLETE, integrated into main**.
- Recovery: check out main, rerun the two gates with the available runtime/browser and compare source paths against the corrected tested source above.

## One next slice

**Exactly one next implementation slice:** **EMF-S09 — BOTH, PC audio**, when separately assigned.  
**Prerequisites:** the reviewed S07 revision; [S08 handoff](EMF-S08-HANDOFF.md), including its separate one-time interactive project MCP approval; eligible real FL exports with measured metadata, provenance and operation-specific rights; existing Node/browser setup. S08 factory-sound renders are playback-only and cannot become reusable palette samples without suitable sample-reuse rights.  
**First action:** read S07/S08 handoffs and the [campaign checkpoint](../campaigns/EMF_INITIAL_INFRASTRUCTURE.md#current-checkpoint), verify the integrated SHA, rerun `npm run check` / `npm run check:browser` as appropriate, and inspect actual exports before importing through the existing S06 contract. Generalize the one bounded DJ/hybrid route only with those facts.  
**Owner action now:** none required. No listening result or FL operation is requested by this handoff.  
**Still not done:** macOS/Linux/Node 24 for S07, real device output, human listening, real FL import/joined playback, broader lifecycle/continuous listening and accepted standalone MVP. Overall campaign effort percentage is **unknown**; test counts do not estimate it. S10 acceptance remains separate and precedes S12 Mission Control integration.
