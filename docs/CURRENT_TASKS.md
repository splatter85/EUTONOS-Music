# Current Tasks

Document ID: `EM-D010`

Updated 2026-11-12. **Plan revised (EM-DEC036): one music ecosystem in three campaigns.** [EMF](campaigns/EMF_INITIAL_INFRASTRUCTURE.md) builds the DJ engine and its Mission Control adapter; [EMD](campaigns/EMD_DJ_APP.md) later puts a human-facing DJ app on the same interface; [EMS](campaigns/EMS_MUSIC_STUDIO.md) improves the owner-local Music Studio generator and exports rated takes to the DJ. EMD and EMS are planned with no slice assigned.

**Music Studio arranger planned (2026-11-13, EM-DEC037).** The owner asked for Beginner, Intermediate and Advanced (timeline) recipe modes, region edits such as "make the vocals louder", the DJ as co-producer and better quality. [The proposal](proposals/STUDIO_ARRANGER.md) and [research](proposals/STUDIO_ARRANGER_RESEARCH.md) add EMS-S07 to S12 to [EMS](campaigns/EMS_MUSIC_STUDIO.md). An owner-local spike generated a 78 s song and two bar-snapped repaints (buildup, drop) in about 4 s each; outside each window the audio stayed identical apart from a level change, and the words did not raise measured loudness. Owner listening of the three test takes is pending; no slice is assigned.

**EMF-S14 DJ transitions I integrated into main (2026-11-12).** A ChatGPT worker built analysis of tempo, key, energy and mix points; opt-in EQ/filter and bass handovers; prepared tempo/pitch renders in workers; and a ready-only automatic `mix` handoff with authored fallback. Reviewed independently (merge with two union conflict fixes; one medium finding about a late-preparation deadline carried into S15) and merged with the Studio work. The Studio DJ Booth gained a third **Beatmatch** transition button. [Guide](DJ_TRANSITIONS.md), [handoff](handoffs/DJ-TRANSITIONS-HANDOFF.md). Merged tree with the Beatmatch button, Windows only (Node 26): `npm.cmd run check` 320 tests passed; `npm.cmd run check:browser` 30 groups passed, including the 10-check Studio gate (now clicking Beatmatch) and 14 mix groups. macOS/Linux not run; physical output and listening NOT TESTED.

Earlier: **S09 is COMPLETE and integrated into main.** Real FL Studio renders, imported through the unchanged S06 contract, play in the DJ's A → procedural bridge → B handoff; the hybrid policy is now chosen by exact route. The owner allowed owner-local sample reuse of the FL factory renders; they stay out of git. [S09 guide](S09_FL_IMPORT.md), [detailed handoff](handoffs/EMF-S09-HANDOFF.md).

**S11 first increment integrated; S11 stays in progress.** A versioned local library, exact recipe replay, stopped restore, bounded renderer history and three recipe studies are in main as library code; the DJ and sampler pages do not use them yet. [S11 guide](S11_LIBRARY.md), [handoff](handoffs/EMF-S11-HANDOFF.md).

**Offline audio analysis prototype COMPLETE and integrated into main (2026-11-10).** Owner-selected `work/analysis-prototype`, based on `504376b18449b89ff6801cf2332600f2692f5d7e`, adds the dependency-free WAV/pack command and 40 DSP/CLI tests. [Guide](AUDIO_ANALYSIS.md), [detailed handoff](handoffs/ANALYSIS-PROTOTYPE-HANDOFF.md). Windows: `npm.cmd run check` passed 222 Node tests; `check:browser` passed 24 native offline + 16 browser groups and 4 S11 groups/24 paired cases. S01 and the existing owner-local FL pack were measured in place; FL A/B: -20.59/-16.43 LUFS, independently matching installed FFmpeg at its displayed precision. No owner-local audio copies/commits, FL operations or playback/DJ changes. This prototype does not advance S10/S11 acceptance. Physical output/listening, macOS/Linux and full meter conformance are untested. Native settings lookup found no runtime launcher; no workflow/RAM/acceptance receipt is claimed. Also in main: [local generator research](proposals/LOCAL_GENERATORS.md) (proposal only, nothing installed or heard) and the blank [S10 listening scorecard](S10_LISTENING_SCORECARD.md) for the owner session.

**EUTONOS Studio integrated into main (2026-11-11).** One page, `/studio.html`, with Produce, DJ Booth and Library tabs over the existing DJ, sampler and S11 library, plus an optional link to the owner's local Music Studio generator service. The S09 DJ and sampler pages are unchanged. [Guide](STUDIO_APP.md). Windows only: both npm gates passed, including the new 10-check Studio browser gate (against a fake generator service). Not a campaign slice; physical output and listening are NOT TESTED.

**Next EMF slice: S15 DJ transitions II**, research-led (a ChatGPT research brief is being prepared), then S16 rated-takes intake, then S10 owner listening on the improved DJ, then S12 Mission Control. Earlier note: **Campaign action: none assigned.** Tested source: `1880867b6b54412bd6119286c98a513239598df2` (S09 plus the S11 increment; Windows only: 182 Node tests, 24 native offline groups, 16 browser groups and the separate S11 browser check; S09 owner-local `check:fl` passed at `0cee096`). **Next slice: S10 - PC + owner**, when separately assigned: the owner listens to the complete flow and accepts or revises it. Physical output and listening are NOT TESTED.

**Campaigns:** [EMF - Initial infrastructure](campaigns/EMF_INITIAL_INFRASTRUCTURE.md) owns the engine's statuses, dependencies and acceptance; [EMD](campaigns/EMD_DJ_APP.md) and [EMS](campaigns/EMS_MUSIC_STUDIO.md) own theirs. The [native EUTONOS board](WORK_ITEMS.md) mirrors it. Every slice requires the [detailed repository handoff and mini chat handoff](WORK_MODEL.md#per-slice-handoff-policy).

| Priority | Next work | Where | Finish line |
| --- | --- | --- | --- |
| 1 | **EMF-S15** DJ transitions II, when assigned | PC or CLOUD | Research-led transition quality: phrase/downbeat accuracy, more styles, stem-aware swaps, objective scoring, and graceful handling when preparation misses its deadline. |
| 2 | **EMF-S16** rated-takes intake (after EMS-S01) | PC | Music Studio rated takes become owner-local DJ material and labelled taste data through the unchanged pack contract. |
| 3 | **EMF-S10**, when separately assigned | PC + owner | Owner listens to the improved DJ with FL and agents closed, and accepts or revises the flow. Does not complete EMF19. |
| 4 | **EMF-S11** remaining work (optional, parallel) | CLOUD | First increment in main. The S11 checks are now in the npm gates. Remaining: wire the library into the pages, wider genres and transition coverage; keep the S09 DJ page unchanged while S10 is judged. |

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

The tested S09 source passed on **Windows only**, Node 26.12.1, headless Chromium 151.0.7922.34 / Playwright 1.62.1:

- `npm.cmd run check`: **166 Node tests**, zero failures; fixture regeneration and media validation passed.
- `npm.cmd run check:browser`: **24 native offline groups** and **16 browser groups**, all passed. Reports/screenshots are local under ignored `artifacts/s09-browser/`.
- `npm.cmd run fl:produce` rendered with real FL Studio 26.1.7.5654 and imported the owner-local pack; `npm.cmd run check:fl` measured its handoff offline and drove it live in headless Chromium (ignored `artifacts/s09-fl/`).

macOS/Linux were not run for S09. There is no automatic CI (EM-DEC030). Physical output and human listening are **NOT TESTED**. This is engineering proof, not an accepted MVP. Overall campaign effort percentage is unknown.

**Run:** on the FL PC, close FL Studio, run `npm run fl:produce`, then `npm run demo` and open http://127.0.0.1:4173/?pack=fl. Set Handoff to Procedural bridge, press Play, then Next Song. The sampler is at /procedural.html?pack=fl. Without FL Studio, the S01 and S06 mock packs still work.

**One next slice: S10 - PC + owner**, when separately assigned. Read the [S09 handoff](handoffs/EMF-S09-HANDOFF.md) and [guide](S09_FL_IMPORT.md). The owner listens with FL and agents closed during playback and accepts or revises the flow. S12 Mission Control integration waits for S10. The rest of S11 may run in parallel on a disjoint scope.

Still unverified: S09 on macOS/Linux, physical output/listening, broader device/browser lifecycle, continuous playback and full MVP acceptance. Historical platform evidence retains its original scope.

```tokenslang-ram-links
{"links":[{"memories":["RAM/record-9358f1df11ab8a840eaa4fe313f7c9a30f057e5f5dad8a4ac6599dabd11a2618.json","RAM/record-b165e3e2039ede2282f1d89db15339710351d4b45ee9a1114e0b6eee41063aa2.json","RAM/record-5e8820539647b94c6ded139ebfa68646d5c3dc4466de2f95316e26ec7eb6e3ad.json","RAM/record-109dc875af359f8f9e370db2005bf476694a629f67a8eb7a380913ab7922d845.json","RAM/record-b04cd86d2e9c28061293d3de6628a4e531fb03c04d01a16c0d7bd32ba939f725.json","RAM/record-c896ef95887776395b07f85c66cecfa50e9c95e08d22860e8d634bd8093c91e0.json","RAM/record-30bcb112c5f700320bf8a6ca12fbfd1a017bd784a2fad08cd48fb5f2785eb3c5.json","RAM/record-729a6a6ad21f65bcb1cf5347f1e30d04af2fc250b16b0113bee0a42ccb4f7b50.json","RAM/record-2dec87edc26e092430f4efb35ee2b18cb5319c706b9d4bf8bdf42baeb8617c82.json","RAM/record-ef70895142494b5eed702acbc30011235ccb66076ac578fb59b4ad7dea1d3f1f.json","RAM/record-8950e96e88b1887f1468ca4651ac99f9883f96b221b930884981e8c76662d4e6.json","RAM/record-aab5fc683662787fd9351474d11ce486c38c53a0cf4209169e487f177f92dbbf.json","RAM/record-cb26b082dedc0381f79071ff3bab937a7a584535ac336d0e256fafd5232c42fb.json","RAM/record-df61c76f2461acbccbbe58772e8f0efed2f26660a48bd1c4379d95c1c33bcde9.json","RAM/record-b3a8e56785924fcbfbaecec1db7d814115a1e2445a4a74a29723a71136a1934c.json"],"work_id":"eutonos-music-development-entry"}],"profile":"eutonos.tokenslang.ram-links.v2"}
```
