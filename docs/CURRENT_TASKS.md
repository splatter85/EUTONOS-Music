# Current Tasks

Document ID: `EM-D010`

Updated 2026-11-04. **S04 CLOUD is complete and integrated into main** on the PC, together with the EUTONOS registration branch.

**Next pickup: EMF-S05 (CLOUD), when separately assigned.** Read the [S04 handoff](handoffs/EMF-S04-HANDOFF.md) and the [campaign checkpoint](campaigns/EMF_INITIAL_INFRASTRUCTURE.md#current-checkpoint), then start from current main, which contains the checked S04 source (`73c456a`) and its docs-only closeout.

**One campaign:** [EMF — Initial infrastructure](campaigns/EMF_INITIAL_INFRASTRUCTURE.md). It owns statuses, dependencies and acceptance. The [native EUTONOS board](WORK_ITEMS.md) mirrors it. Update the board on the PC through the EUTONOS boards CLI, never by hand. Every slice requires the [detailed repository handoff and mini chat handoff](WORK_MODEL.md#per-slice-handoff-policy).

| Priority | Next work | Where | Finish line |
| --- | --- | --- | --- |
| 1 | **EMF-S05**: recorded/procedural handoffs, when assigned | **ChatGPT/GitHub coding environment** | The DJ drives recording A → procedural → a different recording B with checked cues, bass/tail ownership and a safe fade/bridge. Audio and command tests are reproducible, and the handoff is published. |

EUTONOS orientation reads exactly one `tokenslang-work` block. It selects this development entry only. The campaign above owns the actual next slice.

```tokenslang-work
{
  "profile": "eutonos.tokenslang.work.v1",
  "work_id": "eutonos-music-development-entry",
  "goal": "Resolve current authorized work from this Current Tasks page and the EMF campaign; this compatibility entry selects no product slice.",
  "status": "selected",
  "required": [
    { "path": "docs/CURRENT_TASKS.md" },
    { "path": "docs/campaigns/EMF_INITIAL_INFRASTRUCTURE.md" },
    { "path": "AGENTS.md" }
  ],
  "optional": []
}
```

The tested S04 source is `73c456a147dcf24161ce22187e5e62320c5141b5` (tree `92362e7d5dd6552c0255ae0e9220115d104fe052`). It passed on Windows, macOS and Linux in [run 41961109555](https://github.com/splatter85/EUTONOS-Music/actions/runs/41961109555):
- **130 Node tests**;
- unchanged fixture and media checks;
- **15 native audio groups**;
- **11 browser report groups**.

Exact same-seed native replay has zero differing samples or bit patterns and zero maximum error at both 48 kHz and 44.1 kHz. The [evidence](evidence/emf-s04/README.md) keeps the initial replay failures, the diagnosis and the corrected result separately. The S04 closeout commit changes documentation and evidence only.

**First action for S05:** inspect current main and the S04 handoff before changing code. Setup is Node 24.x with `npm ci --ignore-scripts` and `npm run check`. Optional audition: run `npm run demo`, then open http://127.0.0.1:4173/procedural.html. The [S04 guide](S04_PROCEDURAL.md) explains seeded replay, finite resources and shared transport.

**EUTONOS files:** cloud sessions leave `docs/WORK_ITEMS.md`, `NAV/`, `RAM/` and `eutonos.*.json` alone. Keep the single `tokenslang-ram-links` block at the end of this page; never copy or delete it. `tools/eutonos_project.py` stops with "EUTONOS runtime missing" where EUTONOS is not installed, which is expected; continue without it.

**Cloud sequence:** S05 handoffs → S06 importer/mock FL producer → S07 integrated app, tests and scaffold review. No slice starts automatically because CI passed. The S04 audition replacement and whole-performance exit fades do not supply S05's hybrid overlap or role transfer.

**PC lane:** **S08 is complete** ([handoff](handoffs/EMF-S08-HANDOFF.md), [guide](S08_FL_AUTHORING.md)), and its previously queued Windows CI is green. The owner still has to approve the project MCP server once in an interactive Claude Code session. Next, S09 joins the checked cloud build and real FL audio on PC, and S10 is owner listening acceptance. **Only after that does S12 connect Mission Control.** Windows leads real FL/MCP integration; the shared system targets Windows, macOS and Linux. See the [authoritative slice table](campaigns/EMF_INITIAL_INFRASTRUCTURE.md#execution-slices--authoritative-order-and-environment).

Still unverified: physical output, human listening, the joined FL/cloud path and full MVP acceptance. Historical S03 and S08 evidence keeps its original scope. Overall effort percentage is unknown.


```tokenslang-ram-links
{"links":[{"memories":["RAM/record-9358f1df11ab8a840eaa4fe313f7c9a30f057e5f5dad8a4ac6599dabd11a2618.json","RAM/record-b165e3e2039ede2282f1d89db15339710351d4b45ee9a1114e0b6eee41063aa2.json"],"work_id":"eutonos-music-development-entry"}],"profile":"eutonos.tokenslang.ram-links.v2"}
```
