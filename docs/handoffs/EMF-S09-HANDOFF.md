# EMF-S09 — real FL import, imported-pack DJ and hybrid handoff

**Campaign:** EMF / `campaign-emf-001`  
**Slice:** EMF-S09 (BOTH — PC audio)  
**Disposition:** **COMPLETE** for the bounded engineering scope; integrated into main by the coordinator  
**Environment:** the owner's Windows 11 PC with FL Studio 2026 (26.1.7.5654)  
**Base:** main `9c0d142ccb8d81c4cb519c09f88ed984de801dba`, clean at pickup  
**Branch:** `work/emf-s09-fl-import-20261106`  
**Tested source:** **`0cee096a7e2f89ce580365088de1d43aab0f893a`** (all later commits are documentation and records)  
**Recorded:** 2026-11-07

## Assignment and owner choices

S09 joins real FL-produced material through the unchanged pack contract, tests A → procedural → B on Windows, logs timing, sound and lifecycle results, and generalizes the S01-only DJ/hybrid policy. The owner made two choices at pickup:

- **Rights:** owner-local reuse. FL factory-sound renders may be reused as samples on this PC only; they stay out of git and are never published ([EM-DEC033](../DECISIONS.md)).
- **Builder:** Claude (the coordinator) built it directly, with no Codex worker and **no separate review step**. The self-review below is the only review.

The [S09 guide](../S09_FL_IMPORT.md) is the runnable path. The [campaign](../campaigns/EMF_INITIAL_INFRASTRUCTURE.md) owns live status.

## Delivered changes

| Area | Result |
| --- | --- |
| `scripts/fl-producer.ts` (new), `npm run fl:produce` | Real FL producer through the S08 broker and Windows host: disposable template copies, note edits, FL verify and CLI render of two 8-bar recordings and four one-shots, fade-cut shaping of over-long one-shots, owner-local rights, data-only delivery, import into `local/s09-fl/pack/`. Refuses when FL is unavailable or running. |
| `src/hybrid-handoff.ts`, `src/dj.ts` | `HybridPolicy` registry: S05 (S01 route), S06 mock and S09 policies, found by exact route identity. The DJ compiles the bridge with the loaded pack's own policy recipe. |
| `web/app.ts`, `web/index.html` | DJ Pack selector (`?pack=s01 / mock-fl / fl`), titles and queue ids from the pack, locked while playing, unknown pack refused and cleared. |
| `web/procedural.ts`, `web/procedural.html` | Sampler adds the owner-local S09 FL palette. |
| `web/handoff-measure.ts` (new) | Offline four-pass handoff measurement with independent boundaries, exact ownership, clipping and silence checks. |
| `scripts/fl-check.ts` (new), `npm run check:fl` | Owner-local check: offline measurement on the FL pack, live DJ handoff with pause/resume in the bridge, sampler play/stop. |
| `scripts/serve.ts` | Loopback route for `local/s09-fl/pack/` only (json, md, wav). |
| Gates | `web/producer-checks.ts` adds an S09 imported-handoff group on the mock pack (24 offline groups); `scripts/browser-check.ts` adds the imported-pack DJ stage (16 browser groups); `tests/s09-imported-handoff.test.ts` and `tests/server.test.ts` add Node coverage (166 tests). |

Pack schema, importer, renderer, performer, palette contract and S01 fixtures are unchanged. No dependency, credential or audio file was committed.

## FL production evidence

`npm.cmd run fl:produce` ran real FL Studio 26.1.7.5654 (`C:\Program Files\Image-Line\FL Studio 2026\FL64.exe`) through the broker in about 1.6 minutes, FL closed beforehand. Template `fl-factory/create-a-chord-progression`; only disposable workspace copies were written. The owner's projects and FL configuration were not touched, and no license value was read.

| Asset | Natural frames | Kept frames | Shaping |
| --- | --- | --- | --- |
| kick (drum) | 23,340 | 11,024 | fade-cut |
| hat (percussion) | 13,099 | 5,512 | fade-cut |
| bass A2 | 12,638 | 12,638 | none |
| chord Am (harmony) | 119,894 | 44,099 | fade-cut |

Recordings A and B: 8 bars, 120 BPM, A minor, 44.1 kHz stereo. Imported pack `s09-fl@1`, manifest SHA-256 `8ac13fa2229f411584b60e00078cc20d17441b7b2185ee8b860e265579f7c8c4` (current local build; FL renders are not byte-reproducible, so each run gives a new hash). The generator reported the palette compatible for Explore and Drive, and the browser loader accepted the pack.

## Exact verification

Runtime: **Windows 11, Node 26.12.1 (declared Node 24 not installed), Chromium 151.0.7922.34, Playwright 1.62.1.** macOS and Linux were not run.

| Command | Result | Evidence and limits |
| --- | --- | --- |
| `npm.cmd run check` | PASS | **166/166 Node tests**; fixture regeneration unchanged; media validation passed. |
| `npm.cmd run check:browser` | PASS | **24/24 native offline groups, 16/16 browser groups**, no page script errors. Output in ignored `artifacts/s09-browser/`. |
| `npm.cmd run fl:produce` | PASS | Real FL render and import, above. |
| `npm.cmd run check:fl` | PASS | Owner-local, below. Output in ignored `artifacts/s09-fl/fl-check.json`. |
| Relative links / `git diff --check` | PASS at closeout | See the closeout counts in the RAM record. |

### Offline handoff on the real-FL pack

All three cases passed. Boundaries on the output clock, computed independently and matching the plan:

| Case | A start | Bridge enters | A silent | B enters | Bridge ends |
| --- | --- | --- | --- | --- | --- |
| 48 kHz, seed 1, Explore, phrase exit | 0.25 s | 8.25 s | 10.25 s | 16.25 s | 18.25 s |
| 44.1 kHz, seed 1, Explore, phrase exit | 0.25 s | 8.25 s | 10.25 s | 16.25 s | 18.25 s |
| 48 kHz, seed 2, Drive, end-of-A exit | 0.25 s | 8.25 s | 10.25 s | 24.25 s | 24.25 s |

- Ownership: every source was exactly zero outside its window (A after its fade, bridge outside its window, B before entry).
- No clipping. Peaks −1.1 to −6 dBFS.
- Segment RMS: A alone about −21 dB, lead-in −23 dB, bridge −22 dB, B alone −17 dB. B is about 4 dB louder than A; the owner should judge this in S10.
- Longest run below −60 dBFS: 0.47 s.
- Level change across ±250 ms of each boundary: about +27 to +32 dB at bridge entry, A silent and B entry. The window before each boundary falls on a quiet part of the rhythm, so these are measurement-window effects, not a quality judgment.

### Live DJ on the real-FL pack (headless, 48 kHz)

Status log from Play (wall ms / clock frame): Playing at 450 ms; "Bridge entering — A fades for one bar" at 8,450 ms, frame 391,296; "Procedural bridge playing" at 10,451 ms; Pause at 10,487 ms, clock suspended at frame 489,216 and unchanged for 1.5 s; Resume at 12,047 ms; "B entered — bridge percussion fades" at 17,983 ms, frame 774,784; "Handoff complete" at 19,983 ms, frame 870,784; Stop returned to Ready with a new generation and the pack selector unlocked. The schedule said "in 7.9s · bridge seed 2203713906 · explore". The sampler planned 77 sample events from the FL palette, played and stopped. No page errors.

**Audio rendered: yes, offline and headless scheduling. Played on physical output: NOT TESTED. Auditioned by a listener: NOT TESTED. FL Studio involved: yes, for rendering only.**

## Self-review and disposition

Owner-chosen self-review only; not an independent review and not listening approval. Reviewed the full diff from base, rights labels, server exposure, policy lookup, DJ bridge compile, page lifecycle and failure paths. **KEEP for this bounded engineering scope.**

| Finding | Disposition |
| --- | --- |
| FL one-shots exceed role gaps (kick 2×, chord 2.7×). | Fixed in the producer by fade-cut shaping and recorded in `shaping.json`; the importer's −60 dBFS tail rule is not widened. |
| The DJ and hybrid policy named the S01 route and recipe. | Generalized to an exact-route policy registry; planning refuses mismatched performer or recipe; tests cover both directions. |
| Private renders could leak through the server or git. | `local/` is git-ignored; the server allows only `local/s09-fl/pack/` files of three extensions on loopback; tests prove delivery and workspace stay private. |
| After a resume, the execution line reports the resume command, not the handoff. | KEEP: correct per-command reporting; the check uses the status log instead. |
| B is about 4 dB louder than A; the bridge reuses whole one-shots. | DEFER to S10 listening; no mixing change without listening evidence. |

## Git delivery, controls and recovery

- Built directly on `work/emf-s09-fl-import-20261106` from main `9c0d142`. The coordinator updated the board, NAV, RAM and acceptance through the EUTONOS CLIs, fast-forwarded main and pushed it. The work branch was not pushed. The integrated main SHA is in the mini handoff and the RAM record.
- No change to `.claude/`, `.codex/`, `eutonos.installation.json` or external configuration. The single Current Tasks `tokenslang-ram-links` fence is preserved.
- Recovery: check out main, run `npm run check` and `npm run check:browser`; on the FL PC close FL Studio, then run `npm run fl:produce` and `npm run check:fl`.

## One next slice

**EMF-S10 — PC + owner**, when separately assigned: the owner listens to and accepts or revises the complete creation → generator → DJ → app flow, with FL and agents closed during playback.  
**Owner steps:** close FL Studio; run `npm run fl:produce`; run `npm run demo`; open http://127.0.0.1:4173/?pack=fl, pick **Procedural bridge**, press Play, then Next Song; also try /procedural.html?pack=fl.  
**Still not done:** physical output, human listening, macOS/Linux/Node 24, continuous playback, live FL control and the accepted standalone MVP. Campaign effort percentage is unknown. S10 precedes S12 Mission Control.
