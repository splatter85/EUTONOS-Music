# Current Tasks

Document ID: `EM-D010`  
Updated 2026-11-04 — S02 cloud player closeout.

**Pickup for the next instance: EMF-S03 — CLOUD.** Read the [verified S02 handoff](handoffs/EMF-S02-HANDOFF.md), inspect current main and preserve unrelated changes, then follow the [campaign checkpoint](campaigns/EMF_INITIAL_INFRASTRUCTURE.md#current-checkpoint). Every slice requires the [detailed repository closeout and mini chat handoff](WORK_MODEL.md#per-slice-handoff-policy).

**One campaign:** [EMF — Initial infrastructure](campaigns/EMF_INITIAL_INFRASTRUCTURE.md). The campaign alone owns statuses, dependencies and acceptance. No native EUTONOS board is configured.

| Priority | Next work | Where | Finish line |
| --- | --- | --- | --- |
| 1 | **EMF-S03** — thin deterministic DJ and request integration | **ChatGPT/GitHub coding environment** | Connect S01's control contract to the S02 player for state/genre/Next/queue/Hold, with explicit queue priority, cancellation, idempotent retries, no-match fallback, deterministic tests and a published handoff. |

**First check:** use Node 24.x; run `npm ci --ignore-scripts` and `npm run check`. For the current small player, run `npm run demo` and open http://127.0.0.1:4173/. The [S02 guide](S02_PLAYER.md) covers Play A/B and the scheduled transition.

**After S03:** S04 procedural generator → S05 recorded/procedural handoffs → S06 importer/mock FL producer → S07 integrated app, tests and scaffold review. These remain subsequent assignments.

**PC lane:** **S08 remains available in parallel**, using the unchanged S01 contract. Windows leads real FL/MCP integration; the shared system targets Windows, macOS and Linux. S09 joins the checked cloud build and real FL audio on PC; S10 is owner listening acceptance. **Only then S12 connects Mission Control**. S11 is optional cloud hardening; S13 is wider campaign qualification. See the [authoritative slice table](campaigns/EMF_INITIAL_INFRASTRUCTURE.md#execution-slices--authoritative-order-and-environment).

**Owner notices in slice closeouts:** S01 provided the checked pack revision and PC S08 opening; S07 will provide the tested cloud SHA/run commands for PC S09 after FL exports exist. There is no asynchronous notification. Cloud work with eligible fixtures does not wait for installed FL Studio.

The S02 handoff records 54 passing Node tests, unchanged deterministic fixtures and native Chromium offline/live-browser evidence on Windows, macOS and Linux. Physical audio output, human listening, real FL/MCP and full MVP acceptance remain unverified. Overall effort percentage is unknown.
