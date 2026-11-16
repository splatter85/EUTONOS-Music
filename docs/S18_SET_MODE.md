# EMF-S18 DJ set mode

Scope: **EMF-S18, IN PROGRESS.** Increment 1 (rated set intake) is built on a worker branch and is pending review and main integration. The [EMF campaign](campaigns/EMF_INITIAL_INFRASTRUCTURE.md) owns status; [Current Tasks](CURRENT_TASKS.md) owns pickup. This slice builds on [S16 rated takes](S16_RATED_TAKES.md).

## Goal

Let the owner play a DJ **set** made from every take they rated love or like, not only an explicitly authored pair. Dislikes stay in the private inventory as negative examples and are never put into a set. In automatic-mix mode the DJ chooses the transition between any two set songs; no routes are authored at intake.

## Increments

1. **Rated set intake (this increment, Node only).** `importRatedTakes` and `npm run import:rated` accept `--set loved-liked` or `--set TAKE_ID,TAKE_ID,...` and emit one `em.audio-pack.v0` pack with N recordings and `routes: []`. The catalogue records the selection in a new `set` field.
2. **Set playback (later).** The browser loader and DJ accept more than two recordings, mix any song to any song in automatic-mix mode without authored routes, cache per-song analysis and decode lazily within a memory budget.
3. **Set UI (later).** Studio shows the set, its order and transition choices on `studio.html`.

## Increment 1 contract

- **Selection.** `loved-liked` takes every love and like take. An explicit list may name love or like takes only; a dislike, an unknown ID, a repeated ID or fewer than two takes is refused with a clear error. `--set` and `--pair` are mutually exclusive.
- **Order.** Assets follow **catalog order**: the love set, then the like set, each in the export's own order. An explicit list is reordered into catalog order; its typed order is not a playlist. The DJ decides playback order later.
- **Asset IDs.** `s18-` plus the first 24 hex digits of SHA-256 of the take ID. An ID depends only on its take, so the same take keeps its ID in any set.
- **Per asset.** The same facts as the S16 pair: full-length PCM16 audition copy, original and audition hashes, byte counts, PCM format and duration re-checked for every selected take, a **requested** constant 4/4 grid at frame zero (`requested-not-measured`), `key` and `harmony_pitch_classes` null, eligibility `unreviewed`, playback-only rights. A take with unknown requested BPM is refused because it cannot get a grid.
- **Mixed BPMs.** Requested BPMs may differ between set takes. No equal-BPM rule applies because no route is authored; `src/pack.ts` already accepts a pack with zero routes, and its route rules are unchanged.
- **Budget.** The 128 MiB pair cap does not apply. A set allows at most **32 takes** and **512 MiB** of audition audio in total; past either limit the import fails with `SET_TOO_LARGE`. Audio is never shortened to fit. Each audition file stays within the pack's existing 64 MiB per-file limit (about 6 minutes of 44.1 kHz stereo PCM16). The intake raises the importer's delivery read budget only for this call, to 514 MiB; other producers keep the 256 MiB default.
- **Catalogue.** Schema stays `eutonos.rated-catalog.v1`. A new `set` field (null unless `--set` is used) records `selection`, `take_ids`, `asset_ids`, `manifest` (`pack/manifest.json`), `grid` (`requested-not-measured`), `transition` (`none-authored (DJ decides)`), `eligibility` (`unreviewed`), `order` (`catalog`), `total_bytes`, `max_bytes` and `max_takes`. Readers must treat an absent `set` as null. With `--pair`, `pair` is unchanged and `set` is null.
- **Output.** The output rules are unchanged: a new directory outside the export, `OUTPUT_EXISTS` refusal and no published output on any failure.

## Limits of this increment

- **The current browser loader cannot play a set.** `src/browser-pack.ts` accepts one or two recordings and at most 128 MiB, so it refuses the set pack. Increment 2 handles set playback.
- Importing a set into `local/s16-rated/` would break the current rated demo page, which expects the pair. Import the set to its own folder (below).
- Peak memory during import is about twice the set's audio size, because the importer holds source and canonical copies.
- No routes, harmony, measured tempo or downbeats are asserted. Synthetic Node tests only. Windows only. Listening: **NOT TESTED**.
- Worker-branch checks on Windows 11, Node v26.13.0, Chromium 151.0.7922.34 (base main `6d6c072`): `npm run check` passed with 434 Node tests (21 in `tests/rated-takes.test.ts`); `npm run check:browser` passed (24 native offline, 16 browser, 4 S11 groups / 24 cases, 15 Studio and 21 mix results). macOS/Linux not run. The real owner export was not imported.

## Owner command

From this repository on Windows, after a fresh rated export (see [S16](S16_RATED_TAKES.md#run-the-local-handoff)):

```powershell
npm.cmd run import:rated -- --source EXPORT_ROOT --out local/s18-rated-set --set loved-liked
```

This keeps the existing pair in `local/s16-rated/` playable. If you later want to replace `local/s16-rated/` with a set import, first preserve the old folder by renaming it, for example to `local/s16-rated-pair-20261115`, because the importer refuses an existing output.
