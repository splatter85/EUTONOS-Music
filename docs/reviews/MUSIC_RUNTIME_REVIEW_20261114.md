# Music runtime review — 2026-11-14

**Work:** `quick-music-review-20261114`  
**Baseline:** `5cf0129`  
**Branch:** `work/music-review-20261114`  
**Disposition:** **COMPLETE.** All four confirmed P2 findings are fixed; no open findings. Independent final review returned KEEP for Studio and intake; coordinator review returned KEEP for player and intake. Full gates passed; local-main integration/readback verified at `358cc5c4dfa213a6e99b8f7b3bff73c3cfaa059b`.  
**Corrected source SHA:** `1dd748469d0d27236db00ae4eeecee1e8519814a` includes `003ef88` (intake/playback) and `1dd7484` (Studio). Focused and full verification are recorded below; both official gates passed. Local main was fast-forwarded to `358cc5c4dfa213a6e99b8f7b3bff73c3cfaa059b`; readback was clean. Its runtime/test paths (`src`, `web`, `scripts`, `tests`, `package.json`) are unchanged from this tested source. No public push was performed.

## Scope and method

The bounded review covers rated-take input integrity and pack loading, playback ownership and cancellation, and Studio's local generation/preview boundary. Reviewers inspected the existing contracts and callers and used synthetic reproductions. No private export, private audio, FL Studio, installation or physical output was needed for this review. The [rated-takes contract](../S16_RATED_TAKES.md) and [S06 importer contract](../S06_IMPORT.md) retain their existing scope and limitations.

## Confirmed findings

| Severity and area | Root cause and reproduction | Correction and evidence |
| --- | --- | --- |
| **P2 — Output alias can mutate the source export.** `src/rated-takes.ts` | Containment compared a lexical output path with the canonical source path. Create a junction or directory alias pointing to the export and import to `alias/out`: the import succeeds inside the export. A missing parent such as `alias/new-parent/out` follows the same alias. This violates the explicit outside-export output contract. | Fixed: resolve the nearest existing destination ancestor before any directory creation, append missing components and check canonical containment. Regressions cover both alias paths with no source-directory changes and a successful ordinary external nested destination. Build passed; **15/15 rated-intake tests passed**, zero skips, on Windows. Coordinator review: **KEEP**. |
| **P2 — Resume can advance a paused clock before ownership is granted.** `src/player.ts`, with DJ callers/tests | `resume()` invokes `context.resume()` concurrently with the ownership gate. With a delayed or failed gate, the paused audio clock can advance and queued B can be consumed before the ownership decision completes. The reproduction controls the gate and observes clock/queue state before resolving or rejecting it. | Fixed: await ownership admission before native context resumption, with intent checks that discard stale grants after Stop/Pause. Four deferred-grant/refusal regressions went from failing to passing; stale-grant tests also pass. **40 focused player/DJ tests passed**. Coordinator review: **KEEP**. |
| **P2 — Duplicate Generate can submit two jobs.** `web/studio.ts` | The UI does not latch the in-flight submission before the generation POST returns. Delay the POST response and trigger Generate twice: two job requests are submitted. | Fixed: latch `generationPending` synchronously before the POST and clear it on completion/failure. The delayed-submission regression failed before the fix and passes afterward; HTTP 503 requires explicit recovery. Covered by **15 passing Studio browser checks**, Windows / Chromium 151. Independent final review: **KEEP**. |
| **P2 — A stale preview abort can stop its successor.** `web/studio.ts` | Select Alpha, delay its preview load, then select Beta. The old Alpha operation's `AbortError` cleanup can stop the newer Beta preview because cleanup is not bound to the operation that still owns playback. | Fixed: bind preview ownership and cleanup to epochs, so stale aborts cannot stop or relabel a successor. Delayed Alpha-to-Beta selection and mute/Stop/pagehide cancellation are covered by the **15 passing Studio browser checks**. Independent final review: **KEEP**. |

Source paths identify the reviewed areas without retaining line numbers that later corrections may move. The coordinator owns the assembled review, final gate results and local-main integration.

## Executed checks and remaining delivery

- `npm.cmd run build`: passed after the intake correction.
- `node --test dist/tests/rated-takes.test.js`: **15 passed, zero failures/skips**, outside the Windows sandbox so directory renames and the junction test could execute.
- Before correction, a disposable synthetic inventory imported through an output-parent junction successfully and added `out` inside the source. The reproduction directory was removed afterward.
- An earlier sandbox-only run of rated-intake, browser-pack and importer tests hit directory-rename `EPERM` errors and a junction permission skip. These are not passing product evidence. The focused intake run above resolved the relevant environment restriction; the final official gates also passed as recorded below.
- Playback: **40 focused player/DJ tests passed**, including deferred ownership grant/refusal and stale grants after Stop/Pause.
- Studio: **15 browser checks passed**, Windows / Chromium 151, including delayed POST submission, HTTP 503 explicit recovery, successor preview ownership and mute/Stop/pagehide cancellation.
- Final official gates at `1dd748469d0d27236db00ae4eeecee1e8519814a`, Windows 11 / Node 26.13.0 / Chromium 151.0.7922.34: both commands exited **0**.
- `npm.cmd run check`: **428 tests passed, zero failures/skips**; fixture regeneration, media validation and S11 demo passed.
- `npm.cmd run check:browser`: **24 native offline checks, 16 browser checks, 4 S11 groups / 24 paired cases, 15 Studio checks and 21 mix results**; no report errors.
- Local main fast-forwarded to `358cc5c4dfa213a6e99b8f7b3bff73c3cfaa059b`; clean readback verified. `git diff 1dd7484 HEAD -- src web scripts tests package.json` was empty. **No public push was performed.**

## Documented limits retained

Requested tempo and the frame-zero 4/4 audition grid are assumptions, not measured rhythm. Ratings remain taste labels and confer neither rights nor playback review. Full-inventory hash/byte validation is separate from the selected pair's PCM/duration validation. Explicit browser resource-limit refusal is bounded behavior, not a requirement to support arbitrary-sized audio; S02 documents separate packed and decoded ceilings.

This review adds no audio-device or listening qualification. Current executed evidence is **Windows only**; macOS and Linux remain unverified for these changes. **Physical output and human listening: NOT TESTED.** Historical S16 handoffs retain their original source pins and evidence.

**Completion decision:** KEEP for the corrected bounded source, with no open findings. Required full gates passed and local-main integration/readback are verified at `358cc5c4dfa213a6e99b8f7b3bff73c3cfaa059b`. **The bounded review task is COMPLETE.** Overall campaign effort percentage is unknown. **Next campaign slice: EMF-S10 — PC + owner**, when separately assigned, for listening and standalone-flow acceptance; S12 Mission Control follows S10.
