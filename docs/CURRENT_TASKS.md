# Current Tasks

Document ID: `EM-D010`

Updated 2026-11-05. **S06 is complete and in main.** It was built on the owner's PC: any producer's data-only delivery can be imported into a pack, and the S04 performer plays any palette that meets the written contract. A mock FL producer exercises the path; **no FL Studio ran** ([S06 guide](S06_IMPORT.md), [handoff](handoffs/EMF-S06-HANDOFF.md)).

**Next pickup: EMF-S07 (CLOUD, or PC if the owner chooses), when separately assigned.** Read the [S06 handoff](handoffs/EMF-S06-HANDOFF.md) and the [campaign checkpoint](campaigns/EMF_INITIAL_INFRASTRUCTURE.md#current-checkpoint), then start from current main.

**One campaign:** [EMF — Initial infrastructure](campaigns/EMF_INITIAL_INFRASTRUCTURE.md). It owns statuses, dependencies and acceptance. The [native EUTONOS board](WORK_ITEMS.md) mirrors it. Update the board on the PC through the EUTONOS boards CLI, never by hand. Every slice requires the [detailed repository handoff and mini chat handoff](WORK_MODEL.md#per-slice-handoff-policy).

| Priority | Next work | Where | Finish line |
| --- | --- | --- | --- |
| 1 | **EMF-S07**: integrated app/demo and scaffold review, when assigned | Cloud or PC | One integrated demo over S02–S06, repeatable test commands, offline/browser audio checks, review findings and the exact tested commit. It reports **cloud playable proof**, not an accepted MVP. Checks run on each reachable OS, and the change is merged into main with its handoff. |

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

The tested S06 source is `8708c7806bb1ffc1d68c3ed8c2f34d29af0d9f4d`. On **Windows only** (Node 26.12.1 against the declared Node 24; headless Chromium 151) it passed:
- **161 Node tests** (18 new);
- unchanged fixture and media checks;
- **23 native audio groups** (4 new, on the imported mock pack);
- **12 browser report groups** (unchanged).

macOS and Linux were not run for S05 or S06; S04's three-platform evidence keeps its own scope. There is no automatic CI (EM-DEC030): run `npm run check` and `npm run check:browser` on each OS you can reach and say which ran.

**First action for S07:** inspect current main and the S06 handoff before changing code. Setup is Node 24.x with `npm ci --ignore-scripts` and `npm run check`. `npm run mock:fl` regenerates the mock FL pack under `dist/`. Optional audition: `npm run demo`, then open http://127.0.0.1:4173/ and set **Handoff** to **Procedural bridge**.

**EUTONOS files:** cloud sessions leave `docs/WORK_ITEMS.md`, `NAV/`, `RAM/` and `eutonos.*.json` alone. Keep the single `tokenslang-ram-links` block at the end of this page; never copy or delete it. `tools/eutonos_project.py` stops with "EUTONOS runtime missing" where EUTONOS is not installed, which is expected; continue without it.

**Remaining cloud sequence:** S07 integrated app, tests and scaffold review. No slice starts automatically.

**PC lane:** **S08 is complete** ([handoff](handoffs/EMF-S08-HANDOFF.md), [guide](S08_FL_AUTHORING.md)). The owner still has to approve the project MCP server once in an interactive Claude Code session. Next, S09 joins the checked build and real FL audio on PC, and S10 is owner listening acceptance. **Only after that does S12 connect Mission Control.** Windows leads real FL/MCP integration; the shared system targets Windows, macOS and Linux. See the [authoritative slice table](campaigns/EMF_INITIAL_INFRASTRUCTURE.md#execution-slices--authoritative-order-and-environment).

Still unverified: physical output, human listening, S05 and S06 on macOS/Linux, importing real FL output (S09), the joined FL/cloud path and full MVP acceptance. Historical S03, S04 and S08 evidence keeps its original scope. Overall effort percentage is unknown.


```tokenslang-ram-links
{"links":[{"memories":["RAM/record-9358f1df11ab8a840eaa4fe313f7c9a30f057e5f5dad8a4ac6599dabd11a2618.json","RAM/record-b165e3e2039ede2282f1d89db15339710351d4b45ee9a1114e0b6eee41063aa2.json","RAM/record-5e8820539647b94c6ded139ebfa68646d5c3dc4466de2f95316e26ec7eb6e3ad.json"],"work_id":"eutonos-music-development-entry"}],"profile":"eutonos.tokenslang.ram-links.v2"}
```
