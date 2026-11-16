# EMF-S18 DJ set mode

Scope: **EMF-S18, IN PROGRESS.** Increment 1 (rated set intake) is in main. Increments 2 (set playback) and 3 (Studio set UI and phone Auto) are built on `work/emf-s18-set-mode` and are **pending coordinator merge**. Evidence is in the [EMF-S18 handoff](handoffs/EMF-S18-HANDOFF.md). The [EMF campaign](campaigns/EMF_INITIAL_INFRASTRUCTURE.md) owns status; [Current Tasks](CURRENT_TASKS.md) owns pickup. This slice builds on [S16 rated takes](S16_RATED_TAKES.md).

## Goal

Let the owner play a DJ **set** made from every take they rated love or like, not only an explicitly authored pair. Dislikes stay in the private inventory as negative examples and are never put into a set. In automatic-mix mode the DJ chooses the transition between any two set songs; no routes are authored at intake.

## Increments

1. **Rated set intake (in main, Node only).** `importRatedTakes` and `npm run import:rated` accept `--set loved-liked` or `--set TAKE_ID,TAKE_ID,...` and emit one `em.audio-pack.v0` pack with N recordings and `routes: []`. The catalogue records the selection in a new `set` field.
2. **Set playback (pending merge).** The browser loader and DJ accept a set of 2–32 recordings. In automatic-mix mode they mix any song to any song without authored routes, cache per-song analysis and decode lazily within a memory budget. See [Increment 2](#increment-2-set-playback).
3. **Set UI (pending merge).** Studio `studio.html?pack=set` shows the set, an editable queue and Next on a 4- or 8-bar boundary. It adds Auto every 16, 32 or 64 bars with an optional loop, and shows the chosen recipe, bar and tempo change. The phone remote gains an Auto button. See [Increment 3](#increment-3-studio-set-page-and-phone).

## Increment 1 contract

- **Selection.** `loved-liked` takes every love and like take. An explicit list may name love or like takes only; a dislike, an unknown ID, a repeated ID or fewer than two takes is refused with a clear error. `--set` and `--pair` are mutually exclusive.
- **Order.** Assets follow **catalog order**: the love set, then the like set, each in the export's own order. An explicit list is reordered into catalog order; its typed order is not a playlist. The DJ decides playback order later.
- **Asset IDs.** `s18-` plus the first 24 hex digits of SHA-256 of the take ID. An ID depends only on its take, so the same take keeps its ID in any set.
- **Per asset.** The same facts as the S16 pair: full-length PCM16 audition copy, original and audition hashes, byte counts, PCM format and duration re-checked for every selected take, a **requested** constant 4/4 grid at frame zero (`requested-not-measured`), `key` and `harmony_pitch_classes` null, eligibility `unreviewed`, playback-only rights. A take with unknown requested BPM is refused because it cannot get a grid.
- **Mixed BPMs.** Requested BPMs may differ between set takes. No equal-BPM rule applies because no route is authored; `src/pack.ts` already accepts a pack with zero routes, and its route rules are unchanged.
- **Budget.** The 128 MiB pair cap does not apply. A set allows at most **32 takes** and **512 MiB** of audition audio in total; past either limit the import fails with `SET_TOO_LARGE`. Audio is never shortened to fit. Each audition file stays within the pack's existing 64 MiB per-file limit (about 6 minutes of 44.1 kHz stereo PCM16). The intake raises the importer's delivery read budget only for this call, to 514 MiB; other producers keep the 256 MiB default.
- **Catalogue.** Schema stays `eutonos.rated-catalog.v1`. A new `set` field (null unless `--set` is used) records `selection`, `take_ids`, `asset_ids`, `manifest` (`pack/manifest.json`), `grid` (`requested-not-measured`), `transition` (`none-authored (DJ decides)`), `eligibility` (`unreviewed`), `order` (`catalog`), `total_bytes`, `max_bytes` and `max_takes`. Readers must treat an absent `set` as null. With `--pair`, `pair` is unchanged and `set` is null.
- **Output.** The output rules are unchanged: a new directory outside the export, `OUTPUT_EXISTS` refusal and no published output on any failure.

## Limits of increment 1

- Importing a set into `local/s16-rated/` replaces the pair, so `studio.html?pack=rated` stops working until a pair is imported there again. `pack=set` reads the same folder; see [How to run the set](#how-to-run-the-set-owner).
- Peak memory during import is about twice the set's audio size, because the importer holds source and canonical copies.
- No routes, harmony, measured tempo or downbeats are asserted. Synthetic Node tests only. Windows only. Listening: **NOT TESTED**.
- Worker-branch checks on Windows 11, Node v26.13.0, Chromium 151.0.7922.34 (base main `6d6c072`): `npm run check` passed with 434 Node tests (21 in `tests/rated-takes.test.ts`); `npm run check:browser` passed (24 native offline, 16 browser, 4 S11 groups / 24 cases, 15 Studio and 21 mix results). macOS/Linux not run. The real owner export was not imported.

## Increment 2: set playback

- **Loader.** `loadBrowserPack(manifest, true, fetch, {allowUnreviewed: true, set: true})` fetches only the manifest and rights evidence.
  - Every asset must be a recording with timing and an entry cue.
  - Songs are fetched and validated one at a time when needed (`LoadedBrowserPack.lazy`).
  - `SET_LIMITS`: 2–32 recordings, 512 MiB packed and **128 MiB decoded per song**.
  - The one- and two-recording paths are unchanged.
- **Player.** `new SmallPlayer(context, loaded, null)` is a route-free set player.
  - `playAsset(id)` starts any song.
  - `scheduleMixTo(id, {bars, anchor})` plans the move from the playing song to `id` at the next bar boundary. `song` counts bars from the outgoing song's first downbeat (manual Next). `entry` counts from where that song entered the set (Auto).
  - The pair APIs (`pair`, `play('a'|'b')`) refuse in set mode.
  - Only the playing voices and one prepared song stay decoded.
- **Choice order.**
  1. Analyzed **blend**: B is tempo-matched, then returns to its own tempo. Used only when both songs meet the planner's evidence and B fits the time-stretch budget.
  2. Analyzed **cut** on A's mix-out cue.
  3. Route-free **fallback** on A's bar grid:
     - equal tempo (within 0.5%) crossfades 4 bars;
     - up to 8% apart crossfades 1 bar;
     - otherwise a clean cut on the bar.

  B always enters on its first downbeat and is never time-stretched in a fallback. If the boundary bar has no audio, the planner tries earlier bars that still come after the earliest safe frame.
- **Grids.** A song's grid is **measured** when tempo and downbeat confidence are both at least 0.65. Otherwise its **requested** grid is used and the plan labels it `requested`.
- **Analysis cache.**
  - One analysis per song, keyed by the audio's SHA-256, the analysis version, the sample rate and the requested BPM.
  - At most 64 entries. A failed analysis is reported to every caller that shared it, then dropped, so the next request retries.
  - Analysis runs in the existing mix worker on a mono copy (`analyze-one` job).
  - The cache lives in memory only and is lost on reload.
- **DJ.**
  - In set mode every eligible recording is available, and any song can follow any other.
  - Without a queue head, the set continues in catalogue order after the playing song.
  - Queue edits never move the music. Only **Next** moves it, or Auto, which sends Next.
  - `reorderQueue {queueCommandId, toIndex}` is a new manual-only control request. While a Next is outstanding, it re-targets that Next to the new head.
  - Direct and hybrid handoffs answer `no-match` in a set, because a set has no authored routes.

## Increment 3: Studio set page and phone

Open `studio.html?pack=set`. The DJ Booth shows a **Set** card:

- **Queue.**
  - On load, the whole set is queued in catalogue order.
  - ▲/▼ reorder an entry and Remove drops it.
  - "Add to queue" on any song adds it again.
  - "Queue the whole set" re-queues every song after the playing one.
  - Play starts the song at the head of the queue.
- **Next.** Moves to the head of the queue at the next **4- or 8-bar boundary** of the playing song. A selector picks 4 or 8.
- **Auto.** When on, Auto sends one Next per song entry, landing **16, 32 or 64 bars** after that song came in. An entry is keyed by the song and an entry count, so pause/resume never repeats a step, while the same song entering again later (loop, or Stop then Play) gets a new one.
  - It runs from the page's snapshot tick, never from a timer, so it pauses with the player.
  - At the end of the queue it stops: the last song plays out and the set ends.
  - With **Loop the set** on, it re-queues the set and continues.
  - A step that cannot be scheduled is not retried for the same song. Press Next instead.
- **Readout.** The status line and the Set card show:
  - the recipe: beatmatched blend, cut on the beat, plain crossfade or clean cut;
  - the bar of the outgoing song where the handover leaves, and the boundary rule;
  - the tempo change in percent;
  - whether each grid was measured or requested.

  These are plan data, not listening evidence.
- **Phone.**
  - The Set card has the S17 "Stream to phone" toggle.
  - The phone page shows an **Auto** button only when the PC page reports that it can use Auto.
  - `npm run phone` now prints a Studio set address as well as the DJ page address.
  - The phone command is `{command: 'auto', enabled?: boolean}`, allowlisted like `hold`.

Auto stands for the owner pressing Next again, so its requests use the manual control source. The control contract accepts Next only from a manual source.

## How to run the set (owner)

`scripts/serve.ts` serves rated material only from `local/s16-rated/`, so the set must be imported there:

1. Keep the pair: rename `local/s16-rated` to, for example, `local/s16-rated-pair-20261115`. The importer refuses an existing output folder.
2. From this repository on Windows, after a fresh rated export (see [S16](S16_RATED_TAKES.md#run-the-local-handoff)):

   ```powershell
   npm.cmd run import:rated -- --source EXPORT_ROOT --out local/s16-rated --set loved-liked
   ```

3. Run `npm.cmd run demo` and open `http://127.0.0.1:4173/studio.html?pack=set`.
4. Optional phone: run `npm.cmd run phone` in another terminal, then open the Studio set address it prints.

To go back to the pair, rename the folders back. Nothing under `local/` is committed.

## Limits of increments 2 and 3

- **Blend is unavailable for full-length songs.** The time-stretch budget is 12 M samples (frames × channels), so a 180 s stereo song at 44.1 kHz cannot be blended. Those handovers use the analyzed cut or the route-free fallback. Raising this budget is a candidate next slice.
- **Analysis of real owner songs is unverified.** Synthetic tones give low downbeat confidence, so the browser gate exercised only the route-free fallback with requested grids. Node tests cover the blend path with a controlled analysis.
- When a mix-in finishes, the incoming song is reconnected directly at the end of its entry automation. Tests check this approximation; nobody has listened to it.
- The analysis cache is in memory only (no IndexedDB). Waveforms are not drawn for set songs.
- Checked on Windows only; macOS and Linux were not run. Physical output, the real phone and listening are **NOT TESTED**.
