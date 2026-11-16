# EMF-S19 — slice handoff

**Campaign:** EMF / `campaign-emf-001`  
**Slice:** EMF-S19 DJ transitions III  
**Disposition:** IN PROGRESS on `work/emf-s19-transitions`; coordinator review, merge and push pending. This is a recovery checkpoint, not final verification or acceptance.  
**Environment:** PC, Windows 11, Node v26.13.0, headless Chromium 151.0.7922.34. macOS/Linux not run. Physical output and listening are **NOT TESTED**.  
**Base:** origin/main `3cd8d42ac74ab91b499064369ed51802d57c1572`.  
**Committed Part A:** `acfd1ebe2106e261b9cbc67c76267e81665101cb`; guide checkpoint `a599d23`.  
**Committed priority styles:** `f8499c30eb46d0d459dab66a76449e1f54720187`.  
**Final tested source and containing SHA:** pending.

## Scope and delivered checkpoint

The owner's approved order is smooth blends on full songs, then new styles. The [S19 guide](../S19_TRANSITIONS.md) owns the implementation contract; the [campaign](../campaigns/EMF_INITIAL_INFRASTRUCTURE.md) owns status.

Part A replaces the whole-song WSOLA requirement in set mode with a bounded B entry/overlap/tempo-return window. Native B is scheduled ahead at a measured downbeat using the existing audio clock and voice owner. A 20 ms PCM crossfade ends on native B's exact preceding sample. Analysis uses selected, bounded windows and rebinds measured evidence to original song coordinates; late Auto preserves full-song bar numbering. Pair rendering and direct/hybrid route gates remain unchanged.

Stage 1 of Part B is committed: actual outgoing low-pass filter sweep, bounded stereo LUFS loudness match, evaluator gain-adjusted targets with raw/residual differences, persistent per-voice gain, and a Studio recipe chooser affecting future requests. Auto's default recipe order remains unchanged. Independent review fixed live gain binding, bounded evidence containment, aggregate worker transfer budgeting and immutable gain capture. Native and prepared combined sample headroom are checked without changing evaluator thresholds. No delivery claim is made yet for tempo ramp, loop-extend and brake.

Additional focused Windows evidence: planner/player/set/source tests 54/54; evaluator/worker tests 26/26; set browser 9 checks. Generated evaluator loudness match PASS: -26.000 dBTP, maximum momentary deviation 0.084 LU, boundary flux 3.586 dB. Filter sweep WARN: momentary dip 1.616 LU, flux 3.728 dB, no failing metrics. Actual worker recipes on the shared long stereo fixture each prepare 729,600 samples. Loudness match keeps gain 2.5234123 through the join, residual 0 LU, maximum continuation error 6.10e-9 and actual mixed sample peak 0.203994. These are checkpoint results before final full gates, not listening evidence.

## Verification so far

These focused Windows checks ran on the Part A working diff before the source checkpoint commit. Required final gates at a committed source SHA are pending.

| Command/check | Result |
| --- | --- |
| `npm.cmd run build` | PASS |
| `node --test dist/tests/set-mode.test.js dist/tests/mix-prepare.test.js` | 24/24 PASS |
| `node dist/scripts/set-browser-check.js` | 6/6 PASS; actual browser analysis/render workers and OfflineAudioContext |
| Exact 180 s A → 181 s B, stereo 48 kHz, 122 → 128 BPM | Real blend selected and rendered |
| Render input | 729,604 channel samples from B's 17,376,000 native samples; existing 12,000,000-sample ceiling unchanged |
| Analysis input | At most 2,880,000 frames (60 s at 48 kHz) per selected mono window |
| Native seam | Maximum error 0 for the prepared predecessor and first 2,048 native continuation samples |
| Cancellation/lifecycle | Both incoming nodes stop before effect; Pause/Resume does not reschedule; next exit maps back to native B; late Auto64 uses measured evidence at song bar 65 |
| macOS / Linux / physical output / listening / real owner songs | NOT RUN / NOT TESTED |

The synthetic songs are generated kick, bass and triad PCM, imported by the real set importer into disposable folders. No owner material or files under `local/` are used.

## Review and fixes so far

- **Whole-song budget refusal:** render only the required incoming window, without raising WSOLA limits or allocating a full processed song.
- **Late-window coordinates:** preserve original frame coordinates and song bar numbering; do not present extrapolated grids as extra measured cue evidence.
- **Two-node voice lifecycle:** the native continuation owns EOF, both starts are scheduled ahead, and cancellation releases both nodes.
- **Failure cleanup:** guard cleanup so an injected stop failure cannot mask the original native-start error or keep an audible graph connected.

## Boundaries and recording

`scripts/serve.ts`, board/RAM/NAV/acceptance paths and the main checkout are outside this worker's write scope. No pushes or merges are authorized; the coordinator integrates. The S17 master stream tap and the existing playback owner remain in place.

`workflow prepare closeout` was inspected through the managed wrapper. Its first sandboxed call could not read shared-scope eligibility; a call with Git metadata access returned the semantic prompts. Filing would require native catalog/work/RAM records, which this assignment explicitly excludes. No runtime settings were changed, no filing was run and no native receipt is claimed. The coordinator owns native filing; canonical docs and local Git checkpoints remain this worker's recovery route.

## Remaining work and next slice

Finish and review Part B, run both required full gates at the final source commit, replace this checkpoint with actual commands/counts/evaluator numbers, update campaign/Current Tasks to pending coordinator merge, and send one final Crosstalk handback.

After coordinator integration, the next executable slice is **S10 PC listening/standalone acceptance**: use the integrated Studio set page with eligible material and record actual Next/Auto handover observations. Passing engineering checks does not establish that acceptance. Overall campaign effort percentage is unknown.
