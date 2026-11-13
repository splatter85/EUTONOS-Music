# EMS-S03 — slice handoff: snap sections to bars

**Campaign:** EMS / `campaign-ems-001`  
**Slice:** EMS-S03 Snap sections to bars  
**Disposition:** COMPLETE (engineering). Owner listening of bar-snapped edits is still open and is not a condition of this slice.  
**Environment:** PC. Windows 11, Node 26, Python 3.13 (Music Studio venv), RTX 5090. macOS and Linux were not run.  
**Source:** repository commit `e4d4baa` on `main` (bar-grid command; docs in the commit that adds this handoff). Music Studio is owner-local with no remote; its commit `35a9c0a` is on its own `main`.  
**Publication:** see the closing section; the Music Studio commit is local only by design.

## Assignment and scope

From [EMS](../campaigns/EMS_MUSIC_STUDIO.md): ✂ Grab a section and 🩹 Fix a part snap to the take's bar grid. The DJ analysis is exposed as a small Node command that writes JSON, and Music Studio calls it, so there is one implementation. Checks show cut points on bar lines and report downbeat confidence.

Out of scope: better downbeat detection itself (EMF-S15 owns that), region edits (EMS-S08/S09), the timeline (EMS-S10).

## Delivered changes

**Repository (public):**
- `src/bar-grid.ts`: `barGrid(pcm, {bpmHint?, beatsPerBar?})` returns `eutonos.bar-grid.v1`:
  - `tempo {bpm, analysis_bpm, hint_bpm, source, confidence, fit}`
  - `beats_per_bar`, `first_beat`, `beat_seconds`
  - `downbeat {confidence, source: analysis | first-beat, offset_beats}`
  - `beats[]` and `bars[]` in seconds
  - `warnings[]`
- How it works:
  - It reuses `analyzeMixAudio` for the tempo hypothesis and downbeat phase.
  - It fits one constant-tempo grid to a 5 ms onset envelope of the whole file: a coarse search within ±3 % of the hint (or of the analysis tempo), then a fine pass in 0.005 BPM steps.
  - Bar 1 comes from the analysis downbeats only for 4 beats per bar and when their confidence is at least 0.15. Otherwise bar 1 is the first beat, with a warning.
  - Audio over 180 s is analysed on its opening and the grid is extended at constant tempo, with a warning.
- `scripts/bar-grid.ts`: `node dist/scripts/bar-grid.js <file.wav> [--bpm-hint BPM] [--beats-per-bar N]` prints the JSON. Exit code 2 means a usage error; exit code 1 means an analysis error.
- `tests/bar-grid.test.ts` (8 tests) covers:
  - a hint refined to the audio, and a wrong hint corrected
  - no hint
  - 3/4
  - a 190 s file
  - invalid input
  - argument parsing
  - the command's JSON output and exit codes
- **Contract boundary for EMF-S15:** S15 may replace the internals (better tempo and downbeats) but must keep the `eutonos.bar-grid.v1` output unchanged.

**Music Studio (owner-local, described generically):**
- A small module calls the command with the take's requested BPM as the hint. It caches the result beside the take, keyed to the audio's size, modified time and the hint.
- New route `GET /api/takes/{id}/bars`. It returns 503 when the command is unavailable, and the app then falls back to free marking.
- In Fix a part and Grab a section:
  - Faint bar lines are drawn, with every fourth bar numbered.
  - The marked range snaps to bar lines; the start and end of the file are also allowed as edges.
  - Holding Alt marks freely, and a **Snap to bars** toggle shows the measured BPM. It adds "approximate" when the grid carries warnings.
  - The message reads "bars 21–24, 4 bars".
- Fix lineage now records `start_bar`, `end_bar`, `grid_bpm` and `grid_profile`. Range times keep 3 decimals so they stay on the bar lines.
- The README documents the feature and the route.

## Verification and limits

| Check | Result | Evidence / limit |
| --- | --- | --- |
| `npm.cmd run check` (Windows) | PASS, 328 tests | 320 before plus the 8 bar-grid tests; rerun after the review fix |
| `npm.cmd run check:browser` (Windows) | PASS, exit 0, 30 groups including the Studio gate (10 checks); Chromium 151 | |
| Bar grid on the spike take requested at 124 BPM (78 s) | 125.000 BPM, onset fit 14.5, first beat 0.035 s, 41 bars; downbeat confidence low → bar 1 is the first beat | About 0.8 s per run |
| Bar grid on takes requested at 110 and 100 BPM | 109.995 and 100.000 BPM; the 100 BPM take used an analysis downbeat at offset 3 | |
| Song-sheet take requested at 124 BPM (EMS-S07 test) | 125.0 BPM again | Second instance of the same drift |
| Route and cache | Route returns the grid; second call served from the cached file | |
| Browser: drag in Fix a part (Music Studio page, built-in browser) | Snapped to 38.435–46.115 s = bars 21–24 on the 125 BPM grid; Alt gave a free 39.0–46.8 s; untick/re-tick re-snapped; no console errors | Driven by synthetic pointer events, not by hand |
| Independent review (separate agent, read-only) | One finding, fixed: the downbeat vote assumed 4/4, so for other meters bar 1 now starts on the first beat with a warning; the 3/4 test checks it | |

**Audio:** nothing was rendered for this slice; the bar lines were measured on existing takes. Nothing was played or heard by the agent. Whether bar-snapped repaints sound seamless is for the owner's ears.

## Decisions, risks and recovery

- **Requested BPM ≠ rendered BPM.** Two takes asked for at 124 BPM measured 125. A grid built from the requested BPM drifts by about 0.4 s over 30 bars, so snapping uses the measured grid and the request is only a hint. The [arranger proposal](../proposals/STUDIO_ARRANGER.md) carries the correction.
- **Downbeats stay weak.** On generated takes the analysis downbeat confidence is often below 0.15, so bar 1 is the first beat. Bars are evenly spaced and on beats, but bar 1 may be a beat or more early. The UI says "approximate" and keeps Alt for free marking. EMF-S15 owns the fix.
- **Constant tempo and fixed meter are assumed.** That suits generated music with a requested BPM, not live recordings with tempo drift.
- Recovery: deleting a take's cached grid forces a fresh measurement. If the repository is not built, Music Studio keeps working with free marking.

## Next handoff

**Exactly one next actionable slice:** EMS-S07 Song Plan and Intermediate song sheet, PC (done in the same session; see its handoff).  
**Owner action:** try Fix a part / Grab a section on a few takes and say whether bar 1 lands where you expect.  
**Still not done:** reliable downbeats (EMF-S15); owner listening of snapped edits.

## Closeout

The campaign, board and [Current Tasks](../CURRENT_TASKS.md) are updated with this slice. Only the repository commit is published; Music Studio has no remote.
