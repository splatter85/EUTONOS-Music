# S04 local engineering evidence

**Status:** local candidate evidence only; S04 publication and native/browser verification are blocked. [Detailed handoff](../../handoffs/EMF-S04-HANDOFF.md).

| Field | Observed value |
| --- | --- |
| Implementation commit | `d921382ba948b5bad370751c90b39fb695888058` — local only |
| Implementation tree | `a28ff92757aa7c03f479ef4f5921290cfb148008` |
| Intake main | `66e974c9abbebc6ea9e3aaa6bf55dbd053d8a5bb` |
| Branch | `work/emf-s04-procedural-20261104` — no published S04 ref |
| Environment | Linux coding runtime; Node 24.22.1, npm 11.9.0, TypeScript 5.9.3 |
| Command | `npm run check` after `npm ci --ignore-scripts` |
| Result | 127 tests passed, zero failed/skipped; seven fixture files byte-identical; six media files validated |
| Raw output | [local-check.log](local-check.log) |

The log was captured from the final implementation working tree before it was committed at the pin above. The later blocked closeout adds documentation/evidence only. No source, test, fixture, package lock or workflow change is attributed to this log after that pin. Timing values in the log are observations from this runtime, not performance guarantees. An npm environment-config warning did not fail the checks.

The Node tests use deterministic context/source doubles for scheduling and transport. They do **not** render native PCM or exercise the actual browser UI. The written native harness adds six groups to the prior nine, targeting 44.1 and 48 kHz, plus a sampler browser group. It compiled but could not run in the available environment. This folder contains **no S04 native reports or screenshots** and no physical-output/listening evidence.

After explicit publication approval, run the checked source through the existing Windows/macOS/Linux workflow. Preserve actual JSON reports, inspected screenshots, run/platform versions and exact source applicability here. Keep this log as historical local evidence if later code changes; add new versioned evidence instead of relabelling it. Prior S03/S08 green runs remain in their original evidence folders and do not verify S04.
