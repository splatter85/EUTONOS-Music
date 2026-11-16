# S19 DJ transitions III

Status: **IN MAIN for engineering scope (merge `5c4b674`, Windows only)**, built on `work/emf-s19-transitions` from origin/main `3cd8d42`. Full-song blends and all five new styles are implemented; both full Windows gates pass at source `fa665ee9101773c8f05f2c35d3c7276765d51083`. No push or merge was performed. The [campaign](campaigns/EMF_INITIAL_INFRASTRUCTURE.md) owns status and [Current Tasks](CURRENT_TASKS.md) owns pickup. [Detailed handoff](handoffs/EMF-S19-HANDOFF.md).

This is an engineering proof on generated material, not listening acceptance. Windows only; macOS/Linux, real owner songs, physical output and listening are **NOT TESTED**.

## Full-song set blends

Set mode processes B's entry, overlap and tempo return rather than the whole song. The original song remains a native buffer; a short processed buffer ends at a measured B downbeat and a native source is scheduled ahead at that exact owner-clock frame. The processed buffer's final 20 ms are crossfaded onto native B's preceding samples. Both nodes belong to the same `RecordedSource` and output owner; `onended` never starts a source. The 20 ms processed/native splice can have phase or comb-filter coloration; sample continuity alone cannot qualify that sound. Check the splice with actual listening during S10.

Analysis covers a selected minute, with actual evidence rebound to original song coordinates. A late Next/Auto request selects a new outgoing window; the cache key includes its position and policy. Cue evidence is not extrapolated outside that window. Requested grids remain explicitly requested when measured confidence is inadequate. Full-song analysis metadata does not mean the entire song was analyzed.

The existing limits remain: WSOLA input is at most 12,000,000 channel samples / 180 seconds; decoded native songs remain limited by S18. Render allocation depends on the overlap window, not song duration. Tempo and original-channel LUFS worker copies share the 16,777,216-sample analysis transfer budget; the level interval shortens at high sample rates and reports its actual bounds. Whole-native-song finite/sample-peak scanning runs in sequential worker chunks, at most 3,000,000 channel samples / 60 seconds per job, with private copies and a cached receipt. It does not allocate another whole song or claim whole-song LUFS.

Injected non-browser preparation runtimes must provide `scanPeak`; omitting it selects the browser worker implementation.

Pair rendering retains its existing short-buffer budgets. Direct/hybrid route and eligibility gates are unchanged. See [S18 set mode](S18_SET_MODE.md) and [DJ transitions](DJ_TRANSITIONS.md).

## Recipe choices

Studio's **Beatmatch recipe** selector affects future Next/Auto requests. The readout describes the actual selected style or fallback; changing the selector does not rewrite a scheduled handover. Existing Auto choice order is retained. These new styles are explicit opt-ins, not a claim that every pair is eligible.

| Recipe | Eligibility and behavior |
| --- | --- |
| `filter-sweep` | Existing blend tempo/key/cue gates, including static ratio 0.92–1.08. A real outgoing low-pass sweep with complementary entrance/exit curves. |
| `loudness-match` | Blend gates plus non-silent bounded K-weighted levels and whole-native-song sample peaks. Capture the playing A voice's fixed gain; match B with at most 4× gain, constrained by conservative combined equal-power sample headroom. A is not abruptly changed. Report original and residual level differences. |
| `tempo-ramp` | Ratio 0.8–1.25, outside static 0.92–1.08 comfort. Account for the constant relative rate-induced pitch shift in the key relation, within an engineering 0.2-semitone detune bound. Both native sources follow one changing beat grid. Pitch moves; this is not pitch-preserving WSOLA or a guarantee of local chord/vocal compatibility. |
| `loop-extend` | One measured 4/8-bar interval with confident, consistently spaced downbeats; bounded PCM periodicity/energy and seam checks; exclude supplied vocal spans. Repeat it once, then resume A's native material during the overlap. This does not establish vocal-free content. Failed or late preparation selects the normal labeled fallback before effects. |
| `brake` | Large gaps outside ratio 0.8–1.25 with strong measured cue/downbeat evidence. A short native slowdown and gain fade with pitch drop; B enters at its native measured cue with a 20 ms overlap. A deliberately leaves the static beat grid. |

Loudness matching uses a constant gain outside entry/exit automation, including native continuation and a subsequent outgoing transition. It compensates the processor's normalization explicitly before joining native B. For other prepared blend styles, normalization is also undone; if that cannot preserve the native level within the existing peak/effective-gain ceiling, preparation refuses the blend and uses the labeled fallback. The ceiling is a **sample-peak** bound, not a limiter or true-peak qualification. LUFS and residual figures describe their measured windows, not the rest of either song.

## Timing and ownership

Tempo-ramp duration for N beats is `round(2 * N * 60 * sampleRate / (bpmA + bpmB))`. A moves from rate 1 to `bpmB/bpmA`, while B moves from `bpmA/bpmB` to 1. A single integral/inverse map drives source placement, EOF, subsequent Next/Auto and the offline model. Browser playback-rate motion is block-rate; its map is nominal. Native B is allowed to reach its actual EOF rather than being gated early by the analytic estimate, with a conservative lifecycle allowance. Native-rate voices refuse authored cue methods that assume identity timing.

For a loop interval `[X-L, X)`, `fromExitFrame` remains native X. The first effect is S when A reaches X; `entryDelayFrames=L` places B at T=S+L. The prepared finite A buffer repeats the interval and appends the native overlap tail. A rate-mapped outgoing voice uses a scheduled complementary splice rather than assuming its native sample phase is exact. No virtual source frame silently replaces X.

The set transition slot is released once A's outgoing envelope finishes. B's voice retains the finishing processed entry and its already-scheduled native continuation. Next/Auto can prepare in that interval; the following exit is constrained to the native join or later. Cancelling that next request preserves the existing join.

FIFO, Hold, Stop, cancellation and the S17 master stream tap retain their owner. Cancelling before first effect S releases all future nodes and restores A; after S it cannot claim to undo effects even when B's entry T is later. Stop still silences/releases the complete voice. All starts and parameter changes are scheduled ahead on the same audio clock. Timers and callbacks only reconcile and clean up.

## Evaluation and verification

S19's evaluator was offline and Node-only. The dependent [S20 live pre-check](S20_DECKS.md#live-transition-pre-check) shares that evaluator with a worker and gates the already selected Studio set plan before scheduling; it does not change the chooser. Native-rate rendering remains explicitly a `native-rate-model`, not captured browser audio. It places both sources on their intended ramp/loop timeline before applying the faders and filters. Delayed-entry recipes keep the A reference through the prelude. Brake reports beat phase **UNJUDGED**, with a reason: B cue membership alone is not an independent comparison with A's changing grid. Its intentional boundary flux is also unjudged. Smooth recipes retain through-overlap beat/flux checks. `mix-evaluation-thresholds@1` is unchanged. WARN remains admissible under the existing chooser. Loudness windows cover S→E, including the S→T delay, against the continuing A reference. Low-band build-up windows also cover S→E, but compare against the louder processed side: an A-only prelude cannot establish independent low-end loss/continuity from that metric. Loudness and silence checks still apply there.

Generated-fixture results: loudness match PASS; filter sweep WARN; tempo ramp WARN; loop-extend WARN; brake passes its judged metrics, with beat phase and intentional boundary flux explicitly UNJUDGED. Final Windows gates pass after coordinator review fixes (2026-11-16): 492/492 Node tests; 24 native offline, 16 browser, 4 S11 groups / 24 paired cases, 15 Studio, 21 mix, 8 phone and 16 set checks. The [handoff](handoffs/EMF-S19-HANDOFF.md) records exact commands, measurements and review fixes. These results are not a claim about arbitrary songs or seeds.

Repeatable commands (use `npm.cmd` on this Windows setup):

```sh
npm run check
npm run check:browser
npm run check:set
```

No new dependencies or downloaded/proprietary audio. `scripts/serve.ts`, board/RAM/NAV/acceptance paths and the main checkout remain outside this worker's write scope. The coordinator owns merge, push and native filing. The next acceptance step after integration is S10 PC/owner listening; overall campaign effort percentage is unknown.
