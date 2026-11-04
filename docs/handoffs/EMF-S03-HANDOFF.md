# EMF-S03 — deterministic DJ and request integration handoff

| Field | Evidence |
| --- | --- |
| Campaign / slice | EMF / `campaign-emf-001` / **EMF-S03 — CLOUD** |
| Disposition | **COMPLETE for the assigned deterministic DJ/request engineering scope.** Full standalone MVP, physical output and listening acceptance remain open. |
| Date | 2026-11-04, America/Chicago |
| Inspected intake | Clean `main` at `cd5e5255fc0d3fb4d48500f4541cce1e55e984aa`, the owner-specified S08-containing commit. Its 66-test Node baseline passed before implementation. |
| Tested source | [`71d954534087ff1637b8ff0e8fc51c393a89abfa`](https://github.com/splatter85/EUTONOS-Music/commit/71d954534087ff1637b8ff0e8fc51c393a89abfa), tree `2eba5fc6ccfb4b3f475ef92512a37436656f1623`. Branch: `work/emf-s03-dj-20261104`. |
| Data revision | Unchanged `s01-foundation@1`, schema `em.audio-pack.v0`; two original recordings, four samples and one directed A→B route. |
| Local environment | Linux x86_64, Node 24.22.1, npm 11.9.0, TypeScript 5.9.3, pinned development-only Playwright 1.62.1. |
| Hosted evidence | [Successful run 41925003036](https://github.com/splatter85/EUTONOS-Music/actions/runs/41925003036), all three OSes, at the exact tested source above. [Retained reports, screenshots and provenance](../evidence/emf-s03/README.md). |

## Assignment and delivered scope

The S08 completion handoff selected **S03 CLOUD**: connect the S01 state/genre/Next/queue/Hold request contract to the S02 player with deterministic selection, explicit queue priority, cancellation, effect-idempotent retries and visible no-match fallback. S03 implements that bounded coordinator and its browser controls. The full procedural performer, recorded/procedural handoffs, importer, persistence and integrated standalone MVP remain subsequent slices.

| Area / files | Delivered behavior |
| --- | --- |
| `src/dj.ts` | One `DeterministicDj` owns selection, per-command execution outcomes, queued reservations, reconciliation and requests to the existing renderer. The public typed methods are `request()`, `operation()`, `snapshot()`, `setVolume()` and `dispose()`. |
| `src/control.ts` | Additive `em.control.v0` cancellation commands, nullable genre clearing, generation adoption without losing original receipts, prepared-state clearing and source-aware active-state evidence. Existing revision/FIFO rules remain. |
| `src/player.ts`, `src/web-audio.ts` | Cancel a committed future handoff before its entry; restore A's original envelope and natural end, remove B and permit a later checked schedule. Snapshot copies expose native voice/start/end/transition frames. A separate preparation epoch cancels stale decode work without cancelling an unrelated initial Play. |
| `web/app.ts`, `web/index.html`, `web/style.css` | Queue A/B, Play/Pause/Resume/Stop, Next Song, Cancel next, per-entry queue cancellation, requested state/genre, Hold, Volume/Mute. The page separates requested targets, Now, scheduled next, FIFO and execution outcome. All music actions use the DJ. |
| `tests/dj*.test.ts`, control/player/source tests | Deterministic priority, no-match, exact retry, cancellation, supersession, delayed observation and audio-clock boundary regressions. |
| `web/checks.ts`, `scripts/browser-check.ts`, CI workflow | Nine native offline checks, actual S03 browser requests/transport/ownership/layout checks and retained JSON/screenshots on all three target OSes. |

The renderer still owns the single audio clock and at most two native voices. Neither the DJ nor UI schedules audio through a second clock. The original source lifecycle and pack/media bytes are unchanged. S08's authoring facade, configuration and private output are untouched.

## Selection, transport and receipt policy

The explicit manual FIFO head takes priority over automatic state/genre selection. An explicit track may override preferences, but never eligibility, availability or a checked directed route. The head is not skipped if it cannot play next. With no manual head, the DJ filters supported recordings by requested state and optional genre, excludes the current identity, and selects by stable case-sensitive ID order. Default state is **Explore**, which the fixtures support.

Queue, Next and target requests while stopped may select an eligible candidate but never start sound. Play is explicit. While active, an eligible request can schedule the existing A→B route: B enters eight seconds after A, the four-second overlap ends at twelve seconds, and B ends around twenty-four seconds. A missed cue, absent route or unsupported target leaves the current finite source running and reports the reason. B has no checked return route. There is no automatic queue drain, looping, extra fallback music or third voice.

Pause suspends the existing clock and retains committed native schedules. Queue/Next while paused cannot resume output. Stop cancels active/future voices and preparation and preserves entries that have not started. Mute gates output while the clock advances. Hold refuses both manual and automated state/genre changes; explicit queue/Next, cancellation and transport remain available. Releasing Hold does not replay a rejected target.

`cancelQueue` names the originating `queueCommandId`; it removes that exact unstarted entry and cancels its associated preparation or future reservation. `cancelNext` cancels future selection without removing an explicit queue entry. A retained entry needs another Next/Play request before rescheduling. At or after a transition's start, the API refuses to undo the mix and the UI disables Cancel next. Stop/Mute remain immediate.

Acceptance is not playback. An original receipt is stable; its separately queried execution status can progress through queued, scheduled, started and completed, or report blocked/no-match/cancelled/superseded. The effect ledger is claimed before awaits. Exact canonical retries return the original receipt and current execution outcome without another enqueue or native source, including after Stop and generation changes. Reusing an ID for another body is a conflict.

Reservations exist before asynchronous work and reconcile native frames before later effects or teardown. A queue entry is consumed once its scheduled entry is observed on the renderer clock, including muted playback and delayed promise/UI observation. An accepted command or completed decode alone cannot consume it. During a mix, both sources are reported. A manually chosen recording that does not support the requested state reports no bound state instead of relabeling the music.

The API is in-process TypeScript. Page/session receipts do not survive reload. No HTTP/playback-MCP adapter, durable receipt window, expiry/lease protocol or persistent listening history is implied. See [the executable guide](../S03_DJ.md) for full command semantics.

## Reproduce

Use **Node 24.x** from the checkout root:

```sh
npm ci --ignore-scripts
npm run check
npm run demo
```

Open **http://127.0.0.1:4173/** in a browser supporting Web Audio, Web Crypto and Web Locks. Press **Play**, then **Next Song** before A's eight-second cue. To choose explicitly, queue A or B before Play. Try Pause → Queue B → Cancel next → Next Song → Resume to inspect a retained FIFO reservation without auto-resume. A blocked FIFO example is Queue A while A is active, then Queue B; remove the A head and request Next.

For repeatable native browser checks:

```sh
npx playwright install chromium
npm run check:browser
```

A fresh Linux host may require `npx playwright install --with-deps chromium`. The runner writes ignored `artifacts/s03-browser/`. The offline page at **http://127.0.0.1:4173/checks.html** also runs the nine native checks. FL Studio, agents, paid services and runtime npm packages are unnecessary for this demo.

## Executed verification

### Node tests and unchanged data

The assembled source passed local `npm run check`: **101 tests passed, zero skipped**, exact regeneration of **seven fixture files**, and validation of **all six WAVs**. This includes the existing 66 tests from the S08-containing baseline and the new DJ/control/renderer regressions. The final correction changes only two browser-harness diagnostic reads; `npm run build` passed after that correction.

The focused independent review added and ran seven tests against the real player with deterministic Web Audio call recorders, then reran a cancellation-boundary correction. These exercise renderer scheduling calls recorded before their promise is observed. They use context/source doubles, so they establish call order and state rather than native rendering. Hosted native results complement that review.

| Hosted runner | Node / npm | Node / fixture checks | Native checks |
| --- | --- | --- | --- |
| [Ubuntu 26.04.1 LTS](https://github.com/splatter85/EUTONOS-Music/actions/runs/41925003036/job/126906961905), `ubuntu-26.04` | 24.22.1 / 11.19.1 | 101/101; fixture/media PASS | 9 offline checks and all browser groups PASS |
| [macOS 26.6.2](https://github.com/splatter85/EUTONOS-Music/actions/runs/41925003036/job/126906962548), `macos-26-arm64` | 24.22.1 / 11.19.1 | 101/101; fixture/media PASS | 9 offline checks and all browser groups PASS |
| [Windows Server 2025 10.0.26100 Datacenter](https://github.com/splatter85/EUTONOS-Music/actions/runs/41925003036/job/126906962429), `windows-2025-vs2026` | 24.22.2 / 11.19.1 | 101/101; fixture/media PASS | 9 offline checks and all browser groups PASS |

All three browser reports identify **Playwright 1.62.1 / Chromium 151.0.7922.34**. Exact runner OS/image facts come from job logs, not compatibility user-agent strings.

### Native audio evidence

The nine offline checks retain the seven S02 checks: bounded manifest/rights/hash loading, explicit fixture permission, native decoding of all six files, sample-by-sample A→B renders at 48 kHz and 44.1 kHz, silence after release/stale-plan refusal, and exact pickup/nonzero-entry placement. Two new checks render A with a future B, suspend rendering at about two seconds, cancel the handoff, resume and compare every resulting sample with full-length A.

All three platforms' cancellation checks report **zero maximum absolute sample error at both rates**, with 792,000 compared samples at 48 kHz and 727,650 at 44.1 kHz, and a nonzero restored tail. The unchanged sample-error tolerance is **0.000003**. These checks prove removal of B plus restoration of A's native gain automation and natural end, including after some A output has already rendered.

The 44.1 kHz decoder's existing one-frame natural-EOF difference remains separately reported. Exact B entry and scheduled A handoff frames are unchanged; neither the correction nor S03 widens timing/sample tolerances. [Full measurements and provenance](../evidence/emf-s03/README.md) are retained with all three platform reports.

### Native browser and visual evidence

The browser report contains ten result groups: one summarizes the nine offline checks, and nine exercise the live UI. These cover silent stopped requests, initial manual selection and consumption; paused FIFO reservation/cancellation/rescheduling; Hold refusal and release without replay; mute/Resume; one live A→B mix with both sources and queue consumption; unsupported targets; blocked FIFO order and recovery; same-origin ownership conflict/transfer; reload with no auto-play; and mobile controls/layout with no page errors. The group count is not an assertion that ten independent physical audio measurements occurred.

The integrator inspected the successful macOS ready/mobile screenshots. A separate UI reviewer inspected mobile, crossfade and blocked-queue screenshots and found no material clipping, overlap or misleading state. During the mix both sources appear under Now, Cancel next is disabled, and no further source is scheduled. The blocked head remains visibly first. This is a bounded screenshot review, not a complete accessibility audit or physical mobile-device test.

## Review, failures and corrections

The [source review](../reviews/EMF_S03_DJ_REVIEW.md) preserves its historical pin at `56da6caf3418a201bb1ce66b131d36292f7f580e`, tree `c47d2a7b5bc75d2f84f04dc667056461950540be`. That core checkpoint passed 99 Node tests and its native checks on all three OSes, but still had the previous S02 UI. It is not the source of the final S03 UI screenshots.

| Finding | Correction / evidence |
| --- | --- |
| Cancelling an initially queued track during decode could still permit its start. | Retain the initial reservation before awaits and cancel its renderer work when that exact queue entry is removed. |
| Compatible future target rebinding could leave a stale bound state or later complete an obsolete target receipt. | Keep the native source/frame, rebind supported target metadata and mark incompatible older target operations superseded. |
| A queued tail could incorrectly report the head's track identity. | Retain its own identity and explicit FIFO waiting outcome. |
| Native starts could precede promise observation, causing lost schedules, false cancellation or wrong queue consumption. | Adopt actual renderer schedules from retained attempts and reconcile clock crossings before effects. Seven independent regressions exercise these delayed-observation cases. |
| Entry could cross during a cancellation attempt. | Report cancellation blocked and the original operation started, preserve the committed mix and consume the started entry exactly once. Focused follow-up passed. |
| UI ownership cleanup could wait on old cancelled work or be cleared by a stale failure. | Release from current renderer/lease epoch, ignore stale ownership failures and disposed-DJ results, and gate output/release ownership synchronously on page exit. Existing cooperating-tab ownership is retained. |
| Initial assembled run used `innerText()` for a clock diagnostic inside a closed disclosure. | [Run 41924417277](https://github.com/splatter85/EUTONOS-Music/actions/runs/41924417277), source `18c676f8213f876f0db89d88d4a55ea7eb37c97a`, passed Node and offline checks but failed the paused-clock UI assertion. The capture showed correct paused A/B state and no page error. Read `textContent()` for those two hidden diagnostics; suspended/frozen-clock assertions remain unchanged. The corrected source is pinned above. |
| Local Chromium could not launch. | The managed runtime refused a required socket. No restriction was bypassed; actual native browser execution uses the existing GitHub Actions matrix. |

The UI also avoids redundant live-region text mutation and gives loading/natural-ended status priority over stale handoff labels. The executable guide was checked against the controls, including fixed transition length and UI-disabled cancellation after onset.

## Limits, rights and recovery

**Audio was rendered natively and live browser clock/transport behavior was exercised. Physical speaker/headphone output: NOT TESTED. Human listening and musical acceptance: NOT TESTED.** Passing numerical checks does not establish pleasant transitions or perceived device behavior.

The original [S01 provenance](../../fixtures/s01/PROVENANCE.md) remains: generator v1, seed `0x454d4601`, CC0-1.0 synthetic fixtures marked `fixture-only`. The two recordings and four sample inputs are unchanged. No private S08 FL audio, factory content, external samples or credentials were copied into the cloud repo.

The implementation is finite and intentionally limited to the selected two recordings and one directed route. Receipt/history growth is session-local; durable/bounded history, reload reconciliation and external clients remain later work. Safari/Firefox, OS sleep/device changes, physical mobile devices, long sessions/endurance and real output latency remain unqualified. Same-origin Web Locks coordinate cooperating tabs in one browser storage partition, not the OS device, different ports/profiles or separate machines. Stop/reload provide explicit recovery; reload starts silent with a fresh session.

S08 remains independently complete for its bounded PC authoring scope. Its previously queued Windows CI job was inspected during S03 and is now successful: [S08 run 41909105766](https://github.com/splatter85/EUTONOS-Music/actions/runs/41909105766) is green on all three platforms. This is an updated CI observation, not a rerun of live FL operations or an audition of its private render.

## Publication and final applicability

Core, assembled UI and test correction commits were published and fetched back on the S03 branch; their remote trees were compared with local committed trees before alignment. The final documentation/evidence closeout must retain the tested source tree's runtime, tests, fixtures, dependency lock and workflow unchanged. Main still matched the inspected S08-containing commit at the latest pre-closeout read.

Downloaded artifact ZIPs were checked against GitHub's published SHA-256 digests. The raw browser/offline reports and four inspected macOS screenshots are retained with provenance. Documentation verification passed for 20 changed/new Markdown files: 218 local links and ten heading anchors resolve, all 21 document IDs are unique, no stable ID was removed, and all 20 stage IDs, 13 slice IDs and 12 campaign checks remain. The historical Progress prefix is byte-identical to intake; no draft placeholders remain and `git diff --check` passes.

This closeout adds documentation/evidence only to the tested source. Publication targets main with a checked expected prior SHA and preserves unrelated changes. The containing commit cannot name itself; its actual SHA and confirmed main/handoff readback outcome are supplied in the completing chat's mini handoff. The campaign remains the sole live status owner, and this document is an as-of evidence record.

## Next handoff

**Exactly one next actionable slice: EMF-S04 — CLOUD.** Implement a procedural sampler/phrase source using the original S01 palette and the same clock and `prepare/start/exit/release` lifecycle, with distinct seeded variations, bounded resource use and deterministic replay checks. S05 subsequently joins recorded A → procedural → recorded B.

**Prerequisites and first action:** inspect current main/worktree and preserve unrelated work; read AGENTS, Current Tasks, Work Model, the campaign and this handoff. Use Node 24.x, run `npm ci --ignore-scripts` and `npm run check`, then inspect `src/playable-source.ts`, `src/web-audio.ts`, `src/player.ts` and the unchanged S01 sample palette before implementing S04. Current handoff preparation does not execute that slice.

**Owner PC action remains separate:** approve the project MCP server once in an interactive Claude Code session as documented in [S08](EMF-S08-HANDOFF.md). No PC action is needed to unblock S04. S09 later imports eligible real FL material, S10 is owner listening, and S12 Mission Control follows standalone acceptance.

The full campaign remains **IN_PROGRESS** and overall effort percentage is **unknown**. The slice sequence is unchanged. S03 adds no native board/RAM filing, installed PC changes, procedural music, Mission Control connection or full-MVP acceptance.
