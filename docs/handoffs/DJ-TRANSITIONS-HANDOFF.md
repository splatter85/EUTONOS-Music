# DJ transitions — implementation handoff

Status: in progress. This is an owner-assigned branch task, separate from S10 listening acceptance.

## Scope and pickup

- Base: `6670aca1e04e9e855b241a980735a1ac84c9f770` (current local main at pickup).
- Branch: `work/dj-transitions`; separate Windows worktree outside OneDrive.
- Local commits only; coordinator owns integration, publication and native campaign/RAM updates.
- Preserve direct/hybrid policies and all existing page defaults. Add only opt-in mix behavior.
- No FL Studio, authoring calls or `fl:produce`. Owner-local audio may only be analyzed in place.
- Requested, prepared and clock-confirmed audible states remain separate; one player/clock owns scheduling.
- Physical output and listening NOT TESTED. Real-song detection accuracy outside the measured files is unknown.

## Phase status

| Phase | Status | Next concrete result |
| --- | --- | --- |
| 1: analysis | done | 22 new analysis tests and 40 existing analyzer/CLI tests pass on Windows. CLI adds audio-derived estimates without changing existing measurements. |
| 2: EQ/filter automation | not started | Plan-driven bass handover, filter sweeps and gain on the existing audio clock. |
| 3: prepare-time tempo/pitch | not started | Bounded offline processing in a browser worker and plain Node function. |
| 4: planner/DJ/page | not started | Ready-only opt-in scheduling, existing authored fallback and additive browser checks. |

## Initial evidence and choices

Required documents and `src/dj.ts`, `src/web-audio.ts`, `src/hybrid-handoff.ts`, `src/audio-analysis.ts` were read before implementation. Current main was clean; the destination/branch did not already exist. Existing v0 packs require equal authored tempo/harmony on a directed route; new analysis is derived separately from the audio and does not revise that metadata.

Windows environment observed: Node `v26.13.0`, npm `11.20.0`. `npm.cmd ci --ignore-scripts` succeeded (5 packages, no audit findings). Exact Chromium version and phase test counts will be recorded after execution. macOS/Linux have not run this branch.

Research is preceding implementation. Proposed implementation adds no runtime dependencies: original signal-analysis and WSOLA code plus native Web Audio filters. Signalsmith Stretch is MIT, but its published JavaScript wrapper targets an AudioWorklet/AudioNode, so a separate worker/Node binding would be needed for this assignment. No GPL/LGPL code is being imported. Tempo +/-8% and pitch +/-2 semitones are engineering limits, not listening-qualified ranges.

`python tools/eutonos_project.py settings status` reported the EUTONOS runtime missing. No runtime setup was attempted, and no board/RAM/acceptance receipt is claimed. The owner's explicit do-not-edit list remains authoritative.

## Recovery

Inspect branch/status, this handoff and the actual source before continuing. Root commits each completed phase and will replace this checkpoint with exact test evidence, measured BPM/key, license details and remaining limitations.

## Phase 1 executed evidence

`npm.cmd run build` succeeded, followed by `node --test dist/tests/mix-analysis.test.js dist/tests/audio-analysis.test.js dist/tests/analyze-audio-cli.test.js`: **62 passed, 0 failed** (22 new + 40 unchanged). Tolerances: +/-0.25 BPM; every interior beat and accented downbeat within 25 ms. Synthetic ground truth covers 118/120/124 BPM in A minor/C major/D minor, held-out 100/150 BPM G major, pickups, multiple sample rates, anti-phase stereo, silence, short/invalid inputs and deterministic reports. Additional A minor measurements: 100 -> 100.004526, 118 -> 118.007465, 120 -> 120.001011, 124 -> 124.005070, 150 -> 150.006687 BPM. S01/FL in-place measurements and full gates are pending.

An initial energy-only onset prototype confused chord beating with pulse. Channel-power spectral novelty corrected that reproduced defect before this checkpoint; tolerances were not loosened. Key templates are original weights, not copied published profile arrays. No runtime dependencies or GPL/LGPL code were added. Research links and method limits are in `docs/DJ_TRANSITIONS.md`.
