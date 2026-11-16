# S19 DJ transitions III

Status: **IN PROGRESS**, Windows worker branch `work/emf-s19-transitions` from origin/main `3cd8d42`. The [campaign](campaigns/EMF_INITIAL_INFRASTRUCTURE.md) owns status; [Current Tasks](CURRENT_TASKS.md) owns pickup. The coordinator owns merge and push.

The assigned order is full-song smooth blends first, then new transition styles. Part A bounds analysis and prepared PCM by a window rather than song length, schedules native B continuation on the same audio clock, and verifies the join with generated samples. Part B adds eligible filter sweep, tempo ramp, loop-extend, brake and loudness-match styles through the existing recipe planner/evaluator and Studio set readout. If a reduced delivery is necessary, Part A, loudness match and filter sweep take priority; any omitted style must be listed explicitly.

Preserve pair/direct/hybrid route gates, FIFO, Hold, Stop, cancellation at earliestEffect, the S17 stream tap and S18 Next/Auto. `scripts/serve.ts` is protected; browser additions belong under `web/`. No owner audio or material under `local/`, no board/RAM/NAV/acceptance writes, no merge or push by the worker. Existing render budgets and evaluator thresholds are not raised to accommodate whole songs.

Verification pending: focused generated 180-second-and-longer stereo 122 to 128 BPM blends, bounded allocation, native-join sample checks, style eligibility/automation/evaluator cases, a real blend in the set browser gate, then `npm.cmd run check` and `npm.cmd run check:browser` at a committed source SHA. Windows only; macOS/Linux are not run. Physical output and listening are **NOT TESTED**.

Current checkpoint: Sol high owns bounded Part A implementation; the orchestrator owns design review, integration within the worker branch, canonical docs, final gates and closeout. Next: review the window/mapping/continuation contract before style changes.
