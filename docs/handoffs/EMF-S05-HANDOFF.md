# EMF-S05 — slice handoff

**Campaign:** EMF / `campaign-emf-001`  
**Slice:** EMF-S05 — recording → procedural → recording handoff  
**Disposition:** **COMPLETE** for its bounded engineering scope (confirmed in the [campaign](../campaigns/EMF_INITIAL_INFRASTRUCTURE.md#current-checkpoint))  
**Environment:** PC. The slice table labels S05 CLOUD; the owner asked for it to be built on the PC. Windows 11 Pro, Node 26.12.1 (the package declares Node 24.x; Node 24 was not installed and nothing was downloaded), npm with `--ignore-scripts`, Playwright 1.62.1 with headless Chromium 151.0.7922.34.  
**Inspected base SHA / branch:** main `a1a9df336aa69ed3676447828f02c2b806db726d`; work branch `work/emf-s05-handoff-20261105`.  
**Tested source:** `a9fa01d3e43a304e8648f455cb3e56ef5b69bfda` (runtime, tests, page and check scripts). The later closeout commits change documentation and EUTONOS records only.  
**Publication:** merged into main with a plain push (no pull request, per EM-DEC030). The pushed main commit is given in the owner's mini handoff and can be read back with `git ls-remote origin refs/heads/main`.

## Assignment and scope

The DJ drives recording A → a procedural bridge → a different recording B, with checked cues, bass/tail handoff and a safe fade/bridge, plus reproducible audio and command tests. The owner's completion contract includes merging into main.

Excluded: other routes (B → A, chains), new content, vocals, tempo/key changes, physical audio output, listening, macOS/Linux runs, FL Studio, Mission Control. Predecessors used unchanged: the S01 pack and six original WAVs, the S02 clock/player, the S03 DJ rules and the S04 performer.

## Delivered changes

| Area | File | Effect |
| --- | --- | --- |
| Policy and planner | `src/hybrid-handoff.ts` (new) | `S05_HYBRID_POLICY` (`s05-hybrid-handoff@1`): route `s01-a-to-b@1`, performer `s04-s01-performer@1` over `s01-recipe@1`, one-bar percussion-only lead-in, at most one-bar percussion-only tail, exit `phrase` (q16) or `end` (q32). `planHybridHandoff()` refuses before any effect unless route, performer, recipe, pack revision, tempo, 4/4 meter, key and harmony match, cues sit on bar lines, A has a whole bar after its exit, the exit is at least one bar after the lead-in and A's exit is still ahead of the scheduling lead. It returns `fromExit`, `bridgeFull`, `toStart` and `end` as absolute frames. `commitHybridHandoff()` schedules bridge, bridge exit and B, then changes A last. `bridgeSeed()` is FNV-1a (uint32) of the command ID. |
| Procedural source | `src/procedural-source.ts` | Optional `leadIn` role window: notes of other roles in the window are never allocated. `transitionOut(exit, at, retain)` cancels non-retained attacks at or after the exit with a zero-length stop, lets retained roles sound only inside the window under the output fade, and refuses before any effect if a non-retained note would still sound at the exit. Default behaviour is S04's. |
| Recorded source | `src/web-audio.ts` | `RecordedSource.transitionOut(exit, at, fadeOutFrames)` takes a one-off fade length for A's tail bar; the default is unchanged. |
| Player | `src/player.ts` | `scheduleHybrid(bridge, exit = 'phrase')`: check, decode (shared S04 palette cache), prepare bridge and B, check again, commit. Late commits are refused, not moved. A refusal releases the prepared bridge and B and leaves A unchanged. `snapshot().handoff` reports policy, bridge identity, boundaries and a clock-derived phase (`scheduled`, `lead-in`, `bridge`, `tail`, `complete`). Cancel, pause and stop cover the bridge. |
| DJ | `src/dj.ts`, `src/index.ts` | `DjOptions` (`handoff: 'direct' \| 'hybrid'`, `bridgeExit`), `setHandoff()`, `handoffMode`. The bridge plays `drive` when Drive is requested, else `explore`; an unsupported requested state is reported as bridge state `null`, and a bridge that no longer matches a changed request is rescheduled. B is planned and started at its own entry; once the bridge enters, Cancel next, Next and queue removal are refused and Stop keeps a queued B. Otherwise queue, Hold, retries and cancellation keep S03 rules. |
| Page | `web/index.html`, `web/app.ts` | Handoff selector (crossfade default), bridge seed/state in the next-song detail, phase status text, guide timeline; Cancel next is disabled once the bridge enters. |
| Checks | `tests/hybrid-handoff.test.ts` (new), `web/hybrid-checks.ts` (new), `web/checks.ts`, `scripts/browser-check.ts`, `scripts/serve.ts` | 13 Node tests; four native offline groups; one live browser stage with a screenshot. |
| Docs | [S05 guide](../S05_HYBRID.md) (`EM-D023`), [S05 review](../reviews/EMF_S05_HYBRID_REVIEW.md), EM-DEC031, status owners | Also renumbers the CI-removal decision from a duplicate EM-DEC021 to **EM-DEC030** (commit `25445ea`'s message still says EM-DEC021; EM-DEC021 remains the three-OS requirement). |

The pack schema, fixtures, WAVs, S04 performer, dependencies and the S08 FL facade are unchanged. No audio files were added.

## Verification and limits

| Test command or listening check | Actual result | Evidence/limit |
| --- | --- | --- |
| `npm run check` (Windows) | **PASS** — 143/143 Node tests (130 existing + 13 S05), seven byte-identical regenerated fixture files, six WAV validations | Node 26.12.1, not the declared 24 |
| `npm run check:browser` (Windows) | **PASS** — 19/19 native offline groups (15 existing + 4 S05), 12/12 browser report groups (11 existing + 1 live bridge stage) | Headless Chromium 151; reports and screenshots under `artifacts/s04-browser/` (not tracked) |
| macOS / Linux checks | **NOT RUN** | No CI (EM-DEC030); no macOS or Linux machine was used |
| Physical output | **NOT TESTED** | Offline and headless rendering only |
| Listening | **NOT TESTED** | Nobody has heard the bridge |

The 13 Node tests use the audio-context double and cover: policy frames at 48 and 44.1 kHz; refusals (fixture mode, unknown exit, too close, route revision, B in another key, invalidated clock); the seed; the lead-in and role-handoff exit with cancellation; A's one-off fade; player commit, ownership and phases; the `end` exit; cancel before and after the bridge; late and duplicate refusal; pause and stop; the DJ flow, retries, queue, the unchanged direct default and `setHandoff`; an unmet Surge target with B queued (bridge state `null`); the bridge entry making the handoff irrevocable while Stop keeps queued B; and a re-served queue keeping the bridge state honest, with Drive rescheduling a Drive bridge.

Native offline evidence, seed 5 Explore, phrase exit, A starting a quarter-second in:

| Measure | 48 kHz | 44.1 kHz |
| --- | --- | --- |
| A start / bridge enters / A silent / B enters / bridge silent (frames) | 12000 / 396000 / 492000 / 780000 / 876000 | 11025 / 363825 / 452025 / 716625 / 804825 |
| Max error vs independent oracle: A / bridge / B | 5.16e-8 / 2.03e-8 / 0 | 1.09e-7 / 2.08e-8 / 0 |
| Mixed peak (below full scale) | 0.456 | 0.457 |
| Nonzero bridge samples in lead-in / tail | 10800 / 14400 | 9921 / 13228 |
| Most sources sounding at once | 2 | 2 |
| Bridge notes allocated / events | 63 / 69 | 63 / 69 |
| Same-seed mono replay | bitwise equal | bitwise equal |
| Mixed mono vs separated channel sum, max error | 7.45e-9 | 7.45e-9 |
| `end` exit (seed 0x9e3779b9, Drive), max error / mix peak | 5.16e-8 / 0.456 | 1.09e-7 / 0.457 |
| Cancel before the bridge vs uninterrupted A | error 0 (cancel at frame 96000) | error 0 (cancel at frame 88321) |

At 48 kHz the bridge roles sounded only inside their windows (start–end frames, end exclusive): percussion (16 notes) 420000–873600, drum (6) 492000–744000, bass (8) 492000–738000, harmony (1) 636000–684000. Bass therefore starts after A is silent and ends before B enters; only percussion overlaps a recording. The oracle does not import the planner's frame or envelope helpers. The live browser stage reached each phase status in order (bridge entering, bridge playing, B entered, complete) on the real AudioContext clock in headless Chromium; that clock is not a measure of device output.

**Rendered: yes (offline and headless). Played on physical output: no. Auditioned by a listener: no.** Valid waveforms and timing do not show that the bridge sounds good.

## Review

A separate read-only agent reviewed the slice before closeout ([S05 review](../reviews/EMF_S05_HYBRID_REVIEW.md)). It confirmed the frame arithmetic, exit cancellation, commit order, late/duplicate refusal, pre-bridge cancellation and the two-source limit, and found three issues, all corrected before the tested source pin:

1. **Medium:** B was reported started at A's exit cue, eight seconds early, and the queue head was consumed when the bridge entered, so Stop during the bridge lost queued B. B is now planned and started at its own entry; bridge entry refuses Cancel next, Next and queue removal; Stop keeps queued B.
2. **Low:** re-serving a queue did not update the bridge's reported state. A mismatched bridge is now rescheduled, and a re-served bridge claims only a state it serves.
3. **Low:** the `end` exit render lacked a headroom check; it now asserts and reports the mix peak.

Remaining limit: the native groups build the handoff from the planner and sources directly, not through `SmallPlayer.scheduleHybrid()`; that call is covered by Node tests and the live browser stage. The reviewer did not re-review the corrected source.

## Decisions, risks and recovery

- **EM-DEC031** fixes the handoff shape: bass and harmony change owner only across silence, percussion alone bridges each overlap, B enters at full level. This also keeps at most two nonzero sources summed, which Chromium needs for bitwise replay (S04 found three or more summed sources replay inexactly).
- Timing and fade lengths are engineering choices pending S10 listening. A different route, performer or timing needs a new policy revision.
- The bridge has no vocals, so vocal ownership is untested. Tempo, key or meter mismatches are refused, not bridged.
- Node 24 is the declared runtime; these checks ran on Node 26.12.1. A run on Node 24 and on macOS/Linux would close the gap.
- **Last verified state:** tested source `a9fa01d3e43a304e8648f455cb3e56ef5b69bfda` with all checks above passing on Windows.

## Next handoff

**Exactly one next actionable slice:** **EMF-S06 — CLOUD** (portable import/manifest validation and mock FL-producer/MCP contract tests). The owner may choose to build it on the PC instead.  
**Prerequisites:** current main; Node 24.x; `npm ci --ignore-scripts`.  
**First command/action:** read this handoff and the campaign checkpoint, then `npm run check` and `npm run check:browser`, reporting which OS ran them.  
**Owner action:** none for S05. Optional: listen to the bridge with `npm run demo` (Handoff → Procedural bridge); that would be the first listening evidence. The S08 one-time project MCP approval remains separate.  
**Still not done:** macOS/Linux verification of S05, physical output, listening, broader handoffs (EMF11), S06–S07, S09 joining real FL material, S10 acceptance.

## Closeout

The campaign checkpoint, [Current Tasks](../CURRENT_TASKS.md), [Progress](../PROGRESS.md), the native board (through the boards CLI), NAV and RAM were updated in this closeout. The owner receives the mini handoff in chat.
