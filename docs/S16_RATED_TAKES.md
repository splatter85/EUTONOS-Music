# Rated-takes export and DJ intake

Scope: **EMS-S01 + EMF-S16, IN_PROGRESS (assigned 2026-11-14)**. The [EMS campaign](campaigns/EMS_MUSIC_STUDIO.md), [EMF campaign](campaigns/EMF_INITIAL_INFRASTRUCTURE.md) and [Current Tasks](CURRENT_TASKS.md) own status and pickup. This is the assigned contract; completion, runtime checks and delivery evidence remain pending.

## Export

Create an immutable owner-local snapshot with root profile `music-studio.rated-export.v1` and `love`, `like` and `dislike` sets. Each set manifest uses `music-studio.rated-set.v1`. Keep every rated take, including negative examples, with the full original PCM24 audio, raw recipe and a full-length PCM16 audition copy. Record byte hashes for both audio representations and recipe provenance. Preserve the source takes and ratings; rerunning export must not silently overwrite an existing snapshot.

Ratings describe the owner's taste. They do not confer playback review, prove rights or establish musical compatibility. Generated audio and private recipes stay local.

## Run the local handoff

In the owner-local Music Studio app's Python environment, export to a directory that does not exist yet:

```sh
python -m studio.export_rated --out NEW_SNAPSHOT
```

`NEW_SNAPSHOT` is the export root. Keep it outside the public checkout. An existing output is refused; choose a fresh destination rather than overwriting or deleting a previous snapshot.

From this repository on Windows, select two distinct take IDs from that export and import them:

```powershell
npm.cmd run import:rated -- --source EXPORT_ROOT --out local/s16-rated --pair TAKE_A TAKE_B
npm.cmd run demo
```

Replace `EXPORT_ROOT`, `TAKE_A` and `TAKE_B` with the snapshot path and IDs. Open **http://127.0.0.1:4173/studio.html?pack=rated** and press Play explicitly. The Library shows the full private rating inventory; only the selected pair is available for DJ audition. On other shells use `npm` in place of `npm.cmd`; this does not establish verification on those platforms.

The intake output must be new and outside the export root. `OUTPUT_EXISTS` means choose a fresh destination; the demo route expects `local/s16-rated/`, so preserve any previous intake before intentionally replacing that local folder. Omitting `--pair` builds only the inventory and does not create a playable pack. Invalid metadata, unsafe paths, duplicate IDs, missing files, hash/byte mismatches or an invalid pair refuse the import; failed validation publishes no output directory.

## Intake and audition

Validate every exported take's metadata, paths, recipe JSON, byte counts and original/audition hashes into a local catalogue with its taste label. PCM format and duration are independently checked for the selected audition pair; inventory-only file facts retain their export provenance. Catalogue membership is separate from selecting DJ material. An explicit pair of takes with equal **requested** BPM supplies the bounded local audition; requested BPM is not a measured tempo claim.

The audition remains **unreviewed** and owner-local. Use a zero-overlap cut with no assertion of harmonic compatibility. The schema stays `em.audio-pack.v0`: only the zero-overlap route's harmony check is relaxed; positive-overlap routes retain strict harmony checks and existing default eligibility rules. The audition assumes constant requested tempo, 4/4 and a frame-zero downbeat; the grid is **not measured**, and real generated bars may drift from it. The zero-overlap cut may shorten the outgoing take and cut its tail, so it is not a seamless-transition or tail-preservation claim. Full source and audition files stay in the private inventory. Retain one playback owner and explicit playback control.

Use ignored `local/s16-rated/` for local output. Do not commit generated audio, owner-local export contents or private recipes. Synthetic checks and actual local handoff evidence must be reported separately from listening; neither means the owner accepted the music.

After the checked handoff, [S10 owner listening](S10_LISTENING_SCORECARD.md) is next; Mission Control integration waits for that decision.
