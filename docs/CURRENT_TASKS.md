# Current Tasks

Document ID: `EM-D010`

Updated 2026-11-07. **S09 is COMPLETE and integrated into main.** Real FL Studio renders, imported through the unchanged S06 contract, play in the DJ's A → procedural bridge → B handoff; the hybrid policy is now chosen by exact route. The owner allowed owner-local sample reuse of the FL factory renders; they stay out of git. [S09 guide](S09_FL_IMPORT.md), [detailed handoff](handoffs/EMF-S09-HANDOFF.md).

**S11 first increment integrated; S11 stays in progress.** A versioned local library, exact recipe replay, stopped restore, bounded renderer history and three recipe studies are in main as library code; the DJ and sampler pages do not use them yet. [S11 guide](S11_LIBRARY.md), [handoff](handoffs/EMF-S11-HANDOFF.md).

**Current action: none assigned.** Tested source: `1880867b6b54412bd6119286c98a513239598df2` (S09 plus the S11 increment; Windows only: 182 Node tests, 24 native offline groups, 16 browser groups and the separate S11 browser check; S09 owner-local `check:fl` passed at `0cee096`). **Next slice: S10 - PC + owner**, when separately assigned: the owner listens to the complete flow and accepts or revises it. Physical output and listening are NOT TESTED.

**One campaign:** [EMF - Initial infrastructure](campaigns/EMF_INITIAL_INFRASTRUCTURE.md). It owns statuses, dependencies and acceptance. The [native EUTONOS board](WORK_ITEMS.md) mirrors it. Every slice requires the [detailed repository handoff and mini chat handoff](WORK_MODEL.md#per-slice-handoff-policy).

| Priority | Next work | Where | Finish line |
| --- | --- | --- | --- |
| 1 | **EMF-S10**, when separately assigned | PC + owner | Owner listens to the real-FL DJ handoff and sampler with FL and agents closed, and accepts or revises the flow. Does not complete EMF19. |
| 2 | **EMF-S11** remaining work (optional, parallel) | CLOUD | First increment in main. Remaining: wire the library into the pages, add the S11 commands to the gates, wider genres and transition coverage; keep the S09 DJ page unchanged while S10 is judged. |

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

The S11 increment, merged onto S09 at `1880867`, passed on **Windows only** (Node 26.12.1): `npm.cmd run check` **182 Node tests**; `npm.cmd run check:browser` 24 native offline and 16 browser groups; `node dist/scripts/s11-browser-check.js` 4 groups with 24 paired native cases and zero differing bits; `node dist/scripts/s11-library-demo.js` restored all three studies stopped.

The tested S09 source passed on **Windows only**, Node 26.12.1 against declared Node 24, headless Chromium 151.0.7922.34 / Playwright 1.62.1:

- `npm.cmd run check`: **166 Node tests**, zero failures; fixture regeneration and media validation passed.
- `npm.cmd run check:browser`: **24 native offline groups** and **16 browser groups**, all passed. Reports/screenshots are local under ignored `artifacts/s09-browser/`.
- `npm.cmd run fl:produce` rendered with real FL Studio 26.1.7.5654 and imported the owner-local pack; `npm.cmd run check:fl` measured its handoff offline and drove it live in headless Chromium (ignored `artifacts/s09-fl/`).

macOS/Linux were not run for S09. There is no automatic CI (EM-DEC030). Physical output and human listening are **NOT TESTED**. This is engineering proof, not an accepted MVP. Overall campaign effort percentage is unknown.

**Run:** on the FL PC, close FL Studio, run `npm run fl:produce`, then `npm run demo` and open http://127.0.0.1:4173/?pack=fl. Set Handoff to Procedural bridge, press Play, then Next Song. The sampler is at /procedural.html?pack=fl. Without FL Studio, the S01 and S06 mock packs still work.

**One next slice: S10 - PC + owner**, when separately assigned. Read the [S09 handoff](handoffs/EMF-S09-HANDOFF.md) and [guide](S09_FL_IMPORT.md). The owner listens with FL and agents closed during playback and accepts or revises the flow. S12 Mission Control integration waits for S10. The rest of S11 may run in parallel on a disjoint scope.

Still unverified: S09 on macOS/Linux and Node 24, physical output/listening, broader device/browser lifecycle, continuous playback and full MVP acceptance. Historical platform evidence retains its original scope.

```tokenslang-ram-links
{"links":[{"memories":["RAM/record-9358f1df11ab8a840eaa4fe313f7c9a30f057e5f5dad8a4ac6599dabd11a2618.json","RAM/record-b165e3e2039ede2282f1d89db15339710351d4b45ee9a1114e0b6eee41063aa2.json","RAM/record-5e8820539647b94c6ded139ebfa68646d5c3dc4466de2f95316e26ec7eb6e3ad.json","RAM/record-109dc875af359f8f9e370db2005bf476694a629f67a8eb7a380913ab7922d845.json","RAM/record-b04cd86d2e9c28061293d3de6628a4e531fb03c04d01a16c0d7bd32ba939f725.json","RAM/record-c896ef95887776395b07f85c66cecfa50e9c95e08d22860e8d634bd8093c91e0.json","RAM/record-30bcb112c5f700320bf8a6ca12fbfd1a017bd784a2fad08cd48fb5f2785eb3c5.json","RAM/record-729a6a6ad21f65bcb1cf5347f1e30d04af2fc250b16b0113bee0a42ccb4f7b50.json"],"work_id":"eutonos-music-development-entry"}],"profile":"eutonos.tokenslang.ram-links.v2"}
```
