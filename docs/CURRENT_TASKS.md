# Current Tasks

Document ID: `EM-D010`

Updated 2026-11-05. **S05 is complete and in main.** It was built on the owner's PC: the DJ can now drive recording A → a procedural bridge → recording B ([S05 guide](S05_HYBRID.md), [handoff](handoffs/EMF-S05-HANDOFF.md)).

**Next pickup: EMF-S06 (CLOUD, or PC if the owner chooses), when separately assigned.** Read the [S05 handoff](handoffs/EMF-S05-HANDOFF.md) and the [campaign checkpoint](campaigns/EMF_INITIAL_INFRASTRUCTURE.md#current-checkpoint), then start from current main.

**One campaign:** [EMF — Initial infrastructure](campaigns/EMF_INITIAL_INFRASTRUCTURE.md). It owns statuses, dependencies and acceptance. The [native EUTONOS board](WORK_ITEMS.md) mirrors it. Update the board on the PC through the EUTONOS boards CLI, never by hand. Every slice requires the [detailed repository handoff and mini chat handoff](WORK_MODEL.md#per-slice-handoff-policy).

| Priority | Next work | Where | Finish line |
| --- | --- | --- | --- |
| 1 | **EMF-S06**: portable importer and mock FL-producer contract, when assigned | Cloud or PC | Import/manifest validation and mock FL-producer/MCP contract tests show sound enters the generator regardless of producer, with **no claim of actual FL control**. Checks run on each reachable OS, and the change is merged into main with its handoff. |

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

The tested S05 source is `a9fa01d3e43a304e8648f455cb3e56ef5b69bfda`. On **Windows only** (Node 26.12.1 against the declared Node 24; headless Chromium 151) it passed:
- **143 Node tests** (13 new);
- unchanged fixture and media checks;
- **19 native audio groups** (4 new);
- **12 browser report groups** (1 new live bridge stage).

macOS and Linux were not run for S05; S04's three-platform evidence keeps its own scope. There is no automatic CI (EM-DEC030): run `npm run check` and `npm run check:browser` on each OS you can reach and say which ran.

**First action for S06:** inspect current main and the S05 handoff before changing code. Setup is Node 24.x with `npm ci --ignore-scripts` and `npm run check`. Optional audition: `npm run demo`, then open http://127.0.0.1:4173/ and set **Handoff** to **Procedural bridge**.

**EUTONOS files:** cloud sessions leave `docs/WORK_ITEMS.md`, `NAV/`, `RAM/` and `eutonos.*.json` alone. Keep the single `tokenslang-ram-links` block at the end of this page; never copy or delete it. `tools/eutonos_project.py` stops with "EUTONOS runtime missing" where EUTONOS is not installed, which is expected; continue without it.

**Remaining sequence:** S06 importer/mock FL producer → S07 integrated app, tests and scaffold review. No slice starts automatically.

**PC lane:** **S08 is complete** ([handoff](handoffs/EMF-S08-HANDOFF.md), [guide](S08_FL_AUTHORING.md)). The owner still has to approve the project MCP server once in an interactive Claude Code session. Next, S09 joins the checked build and real FL audio on PC, and S10 is owner listening acceptance. **Only after that does S12 connect Mission Control.** Windows leads real FL/MCP integration; the shared system targets Windows, macOS and Linux. See the [authoritative slice table](campaigns/EMF_INITIAL_INFRASTRUCTURE.md#execution-slices--authoritative-order-and-environment).

Still unverified: physical output, human listening, S05 on macOS/Linux, the joined FL/cloud path and full MVP acceptance. Historical S03, S04 and S08 evidence keeps its original scope. Overall effort percentage is unknown.


```tokenslang-ram-links
{"links":[{"memories":["RAM/record-9358f1df11ab8a840eaa4fe313f7c9a30f057e5f5dad8a4ac6599dabd11a2618.json","RAM/record-b165e3e2039ede2282f1d89db15339710351d4b45ee9a1114e0b6eee41063aa2.json","RAM/record-5e8820539647b94c6ded139ebfa68646d5c3dc4466de2f95316e26ec7eb6e3ad.json"],"work_id":"eutonos-music-development-entry"}],"profile":"eutonos.tokenslang.ram-links.v2"}
```
