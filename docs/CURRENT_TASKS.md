# Current Tasks

Document ID: `EM-D010`

Updated 2026-11-07. **S09 is COMPLETE and integrated into main.** Real FL Studio renders, imported through the unchanged S06 contract, play in the DJ's A → procedural bridge → B handoff; the hybrid policy is now chosen by exact route. The owner allowed owner-local sample reuse of the FL factory renders; they stay out of git. [S09 guide](S09_FL_IMPORT.md), [detailed handoff](handoffs/EMF-S09-HANDOFF.md).

**Current action: none assigned.** Tested source: `0cee096a7e2f89ce580365088de1d43aab0f893a` (Windows only: 166 Node tests, 24 native offline groups and 16 browser groups; owner-local `check:fl` passed). **Next slice: S10 - PC + owner**, when separately assigned: the owner listens to the complete flow and accepts or revises it. Physical output and listening are NOT TESTED.

**One campaign:** [EMF - Initial infrastructure](campaigns/EMF_INITIAL_INFRASTRUCTURE.md). It owns statuses, dependencies and acceptance. The [native EUTONOS board](WORK_ITEMS.md) mirrors it. Every slice requires the [detailed repository handoff and mini chat handoff](WORK_MODEL.md#per-slice-handoff-policy).

| Priority | Next work | Where | Finish line |
| --- | --- | --- | --- |
| 1 | **EMF-S10**, when separately assigned | PC + owner | Owner listens to the real-FL DJ handoff and sampler with FL and agents closed, and accepts or revises the flow. Does not complete EMF19. |
| 2 | **EMF-S11** (optional, parallel) | CLOUD | Post-proof persistence, genres, recipe/history and transition coverage; disjoint from S10. |

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

The tested S07 source passed on **Windows only**, Node 26.12.1 against declared Node 24, headless Chromium 151.0.7922.34 / Playwright 1.62.1:

- `npm.cmd run check`: **161 Node tests**, zero failures, seven deterministic fixture files and six WAV metadata/hash checks passed.
- `npm.cmd run check:browser`: **23 native offline groups** and **15 browser report groups**, including three S07 UI groups, all passed. Reports/screenshots are local under ignored `artifacts/s07-browser/`.

macOS/Linux were not run for S07. There is no automatic CI (EM-DEC030). Physical output and human listening are **NOT TESTED**. This is a playable engineering proof, not an accepted MVP. Overall campaign effort percentage is unknown.

**Run:** `npm run demo`, then open http://127.0.0.1:4173/. Try Play -> Next Song with Handoff set to Procedural bridge, then follow **Play the S06 imported mock palette**. On the sampler, Stop before choosing a different palette, seed or arrangement. No FL Studio, downloads, credentials or proprietary audio are needed.

**Coordinator boundary:** leave `docs/WORK_ITEMS.md`, `NAV/`, `RAM/`, `eutonos.*.json` and agent configuration untouched in this worker handback. Keep the single RAM links block below intact. S07 is not integrated or accepted until the coordinator verifies the target.

**One next implementation slice: S09 - BOTH, PC audio**, after coordinator integration and separate assignment. Read the [S07 handoff](handoffs/EMF-S07-HANDOFF.md) and the [S08 handoff](handoffs/EMF-S08-HANDOFF.md); inspect actual eligible FL exports and their intended-use rights before import. S08 remains complete for its bounded Windows authoring scope; its separate one-time interactive project MCP approval remains an owner step. S10 is owner listening acceptance; S12 Mission Control integration waits for it. S07 starts neither slice nor any FL operation.

Still unverified: S07 on macOS/Linux and Node 24, physical output/listening, real FL import and joined DJ/hybrid playback, broader device/browser lifecycle, and full MVP acceptance. Historical platform evidence retains its original scope.

```tokenslang-ram-links
{"links":[{"memories":["RAM/record-9358f1df11ab8a840eaa4fe313f7c9a30f057e5f5dad8a4ac6599dabd11a2618.json","RAM/record-b165e3e2039ede2282f1d89db15339710351d4b45ee9a1114e0b6eee41063aa2.json","RAM/record-5e8820539647b94c6ded139ebfa68646d5c3dc4466de2f95316e26ec7eb6e3ad.json","RAM/record-109dc875af359f8f9e370db2005bf476694a629f67a8eb7a380913ab7922d845.json","RAM/record-b04cd86d2e9c28061293d3de6628a4e531fb03c04d01a16c0d7bd32ba939f725.json"],"work_id":"eutonos-music-development-entry"}],"profile":"eutonos.tokenslang.ram-links.v2"}
```
