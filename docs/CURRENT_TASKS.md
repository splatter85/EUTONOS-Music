# Current Tasks

Document ID: `EM-D010`  
Updated 2026-11-04 — S03 CLOUD complete for its bounded DJ/request scope; next pickup is S04 CLOUD.

**Pickup for the next instance: EMF-S04 — CLOUD.** Read the [verified S03 handoff](handoffs/EMF-S03-HANDOFF.md), inspect current main and preserve unrelated changes, then follow the [campaign checkpoint](campaigns/EMF_INITIAL_INFRASTRUCTURE.md#current-checkpoint). Every slice requires the [detailed repository closeout and mini chat handoff](WORK_MODEL.md#per-slice-handoff-policy).

**One campaign:** [EMF — Initial infrastructure](campaigns/EMF_INITIAL_INFRASTRUCTURE.md). The campaign alone owns statuses, dependencies and acceptance. No native EUTONOS board is configured.

| Priority | Next work | Where | Finish line |
| --- | --- | --- | --- |
| 1 | **EMF-S04** — first procedural sampler/phrase source | **ChatGPT/GitHub coding environment** | Use the original S01 palette and the same clock and `prepare/start/exit/release` lifecycle; prove distinct seeded variations, bounded resources and replay behavior, then publish the detailed and mini handoffs. |

**First check:** use Node 24.x; run `npm ci --ignore-scripts` and `npm run check`. Inspect `src/playable-source.ts`, the Web Audio renderer and the unchanged S01 sample palette before designing the source. For the current DJ demo, run `npm run demo` and open http://127.0.0.1:4173/. The [S03 guide](S03_DJ.md) covers Play, Next, FIFO, Hold and cancellation.

**After S04:** S05 recorded/procedural handoffs → S06 importer/mock FL producer → S07 integrated app, tests and scaffold review. These remain subsequent assignments; preparing this pickup does not start S04.

**PC lane:** **S08 is complete** ([handoff](handoffs/EMF-S08-HANDOFF.md), [guide](S08_FL_AUTHORING.md)): one MCP facade for Claude Code and Codex edits, verifies, renders and packages a disposable FL project on Windows. The owner still approves the project MCP server once in an interactive Claude Code session; this does not block S04. S08's formerly queued Windows CI job is now green. Windows leads real FL/MCP integration; the shared system targets Windows, macOS and Linux. S09 joins the checked cloud build and real FL audio on PC; S10 is owner listening acceptance. **Only then S12 connects Mission Control**. S11 is optional cloud hardening; S13 is wider campaign qualification. See the [authoritative slice table](campaigns/EMF_INITIAL_INFRASTRUCTURE.md#execution-slices--authoritative-order-and-environment).

**Owner notices in slice closeouts:** S01 provided the checked pack revision and PC S08 opening; S07 will provide the tested cloud SHA/run commands for PC S09 after FL exports exist. There is no asynchronous notification. Cloud work with eligible fixtures does not wait for installed FL Studio.

The S03 source `71d954534087ff1637b8ff0e8fc51c393a89abfa` passed **101 Node tests**, unchanged deterministic fixture/media checks, **nine native offline checks** and the complete S03 browser flow on Windows, macOS and Linux ([run](https://github.com/splatter85/EUTONOS-Music/actions/runs/41925003036)). Cancellation restored full A with zero measured sample error at 48 kHz and 44.1 kHz. Physical audio output, human listening, live procedural music, joined FL/cloud playback and full MVP acceptance remain unverified. Overall effort percentage is unknown.
