# Current Tasks

Document ID: `EM-D010`

Updated 2026-11-04 — **S04 CLOUD COMPLETE on its separate published branch. Main remains unchanged by owner instruction.**

**Next pickup: EMF-S05 — CLOUD, when separately assigned.** Read the [S04 handoff](handoffs/EMF-S04-HANDOFF.md) and [campaign checkpoint](campaigns/EMF_INITIAL_INFRASTRUCTURE.md#current-checkpoint), then fetch `work/emf-s04-procedural-20261104`. S05 must start from this checked S04 branch; main intentionally remains at `66e974c9abbebc6ea9e3aaa6bf55dbd053d8a5bb`. Do not merge or update main as part of the S04 delivery.

**One campaign:** [EMF — Initial infrastructure](campaigns/EMF_INITIAL_INFRASTRUCTURE.md). It owns statuses, dependencies and acceptance. No native EUTONOS board is configured. Every slice requires the [detailed repository handoff and mini chat handoff](WORK_MODEL.md#per-slice-handoff-policy).

| Priority | Next work | Where | Finish line |
| --- | --- | --- | --- |
| 1 | **EMF-S05** — recorded/procedural handoffs, when assigned | **ChatGPT/GitHub coding environment** | DJ drives recording A → procedural → different recording B with checked cues, bass/tail ownership and safe fade/bridge; reproducible audio/command tests and published handoff. |

S04 tested source `73c456a147dcf24161ce22187e5e62320c5141b5`, tree `92362e7d5dd6552c0255ae0e9220115d104fe052`, passed **130 Node tests**, unchanged fixture/media checks, **15 native audio groups** and **11 browser report groups** on Windows, macOS and Linux in [run 41961109555](https://github.com/splatter85/EUTONOS-Music/actions/runs/41961109555). Exact same-seed native replay has zero differing samples/bit patterns and zero maximum error at both 48 kHz and 44.1 kHz. [Evidence](evidence/emf-s04/README.md) preserves initial replay failures, diagnosis and the corrected result separately. The containing closeout changes documentation/evidence only.

**First action for S05:** inspect current main and the published S04 branch/handoff before changing code. Node 24.x setup remains `npm ci --ignore-scripts` and `npm run check`. Optional audition: `npm run demo`, then http://127.0.0.1:4173/procedural.html. The [S04 guide](S04_PROCEDURAL.md) explains seeded replay, finite resources and shared transport. No PC pull or owner action is required to finish S04.

**Cloud sequence:** S05 handoffs → S06 importer/mock FL producer → S07 integrated app, tests and scaffold review. No next slice starts automatically from CI success. S04 audition replacement and whole-performance exit fades do not supply S05 hybrid overlap or role transfer.

**PC lane:** **S08 is complete** ([handoff](handoffs/EMF-S08-HANDOFF.md), [guide](S08_FL_AUTHORING.md)); its previously queued Windows CI is green. The owner still approves the project MCP server once in interactive Claude Code. That separate action does not block S04. S09 joins the checked cloud build and real FL audio on PC; S10 is owner listening acceptance; **only then S12 connects Mission Control**. Windows leads real FL/MCP integration while the shared system targets Windows, macOS and Linux. See the [authoritative slice table](campaigns/EMF_INITIAL_INFRASTRUCTURE.md#execution-slices--authoritative-order-and-environment).

Physical output, human listening, the joined FL/cloud path and full MVP acceptance remain unverified. Historical S03/S08 evidence retains its original scope. Overall effort percentage is unknown.
