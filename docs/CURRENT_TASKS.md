# Current Tasks

Document ID: `EM-D010`  
Updated 2026-11-04 — S04 CLOUD implemented locally; **BLOCKED at publication and native verification**.

**Pickup for the next instance: resume EMF-S04 — CLOUD.** Read the [S04 blocked handoff](handoffs/EMF-S04-HANDOFF.md), inspect current local/remote state, preserve the local commits, and follow the [campaign checkpoint](campaigns/EMF_INITIAL_INFRASTRUCTURE.md#current-checkpoint). S04 is not complete or integrated into main. Every slice requires the [detailed repository closeout and mini chat handoff](WORK_MODEL.md#per-slice-handoff-policy); publication of this blocked closeout is also pending.

**One campaign:** [EMF — Initial infrastructure](campaigns/EMF_INITIAL_INFRASTRUCTURE.md). The campaign alone owns statuses, dependencies and acceptance. No native EUTONOS board is configured.

| Priority | Next work | Where | Finish line |
| --- | --- | --- | --- |
| 1 | **Resume EMF-S04** — publish and verify the existing procedural candidate | **ChatGPT/GitHub coding environment** | Obtain the explicit public-publication authorization required by automatic approval review, publish/read back the scoped branch, pass the written Windows/macOS/Linux native/browser gate, retain actual evidence, then publish/read back the completed closeout and checked main integration. |

**Last local source checkpoint:** `d921382ba948b5bad370751c90b39fb695888058`, tree `a28ff92757aa7c03f479ef4f5921290cfb148008`, on `work/emf-s04-procedural-20261104`. It adds a finite eight-bar seeded sampler over the original S01 palette and shared source/player lifecycle. **127 Node tests pass**, with unchanged deterministic fixture/media checks. The independent source review's six regressions are included. Six new native offline groups and the sampler UI flow are written and compiled but **NOT RUN**.

**First action:** inspect the worktree and remote main, then verify owner approval to publish this S04 source/test/workflow/documentation payload to the public repository and integrate after required checks pass. Automatic approval review rejected the attempted push; do not substitute another write tool to evade it. Main was last read back at `66e974c9abbebc6ea9e3aaa6bf55dbd053d8a5bb`, with no S04 branch. After approval, publish the candidate and use the existing Node 24 three-OS workflow for native/browser execution. A changed workspace should first run `npm ci --ignore-scripts` and `npm run check`.

For the local audition candidate, run `npm run demo` and open http://127.0.0.1:4173/procedural.html. The [S04 guide](S04_PROCEDURAL.md) describes seed/state replay, resource bounds and transport. Local Chromium could not launch its required socket, the connected-browser context was unavailable, and the cloud browser could not reach the local server; no S04 native render or browser screenshot exists.

**After completed S04:** S05 recorded/procedural handoffs → S06 importer/mock FL producer → S07 integrated app, tests and scaffold review. Do not advance to S05 while the current S04 verification/publication gate remains open.

**PC lane:** **S08 is complete** ([handoff](handoffs/EMF-S08-HANDOFF.md), [guide](S08_FL_AUTHORING.md)): one MCP facade for Claude Code and Codex edits, verifies, renders and packages a disposable FL project on Windows. The owner still approves the project MCP server once in an interactive Claude Code session; this is separate from the S04 block. S08's formerly queued Windows CI is now green. Windows leads real FL/MCP integration; the shared system targets Windows, macOS and Linux. S09 joins the checked cloud build and real FL audio on PC; S10 is owner listening acceptance. **Only then S12 connects Mission Control**. S11 is optional cloud hardening; S13 is wider campaign qualification. See the [authoritative slice table](campaigns/EMF_INITIAL_INFRASTRUCTURE.md#execution-slices--authoritative-order-and-environment).

**Owner notices in slice closeouts:** S01 provided the checked pack revision and PC S08 opening; S07 will provide the tested cloud SHA/run commands for PC S09 after FL exports exist. There is no asynchronous notification. Cloud work with eligible fixtures does not wait for installed FL Studio.

The [S03 handoff](handoffs/EMF-S03-HANDOFF.md) retains its verified 101-test, nine-native-check and full-browser evidence on Windows/macOS/Linux. Those historical results do not qualify S04. Physical audio output, human listening, native procedural rendering, joined FL/cloud playback and full MVP acceptance remain unverified for the current candidate. Overall effort percentage is unknown.
