# EMS — Music Studio

Campaign ID: `campaign-ems-001`  
Short ID: `EMS`  
Document ID: `EM-D028`  
Owner document: this file  
Status: **PLANNED - backlog recorded; no slice assigned**  
Recorded 2026-11-12, America/Chicago

Progress estimate: **unknown**. Nothing in this campaign has started as a campaign slice. The app already exists and works (see Inputs); this campaign plans what comes next.

## Outcome

Music Studio is the owner's local AI-generation app: a small web app on the owner's PC that drives a local text-to-music model, keeps every take with its full recipe, and lets the owner rate takes ❤️ / 👍 / 👎. This campaign makes it a better finishing tool and turns its rated takes into material and taste data for the EUTONOS DJ and procedural generator.

It belongs to the same ecosystem as [EMF](EMF_INITIAL_INFRASTRUCTURE.md) (the DJ engine and Mission Control adapter) and [EMD](EMD_DJ_APP.md) (the human-facing DJ app). See [EM-DEC036](../DECISIONS.md).

## Scope and boundaries

- **Code lives outside this repository.** Music Studio is an owner-local, unpublished app. This public document plans it in generic terms and holds no private paths, takes or audio.
- **Generated audio stays owner-local** unless the owner separately decides a specific piece may be published. Only data that is safe to publish (schemas, export formats, measured features without audio) may enter this repository.
- **👎 takes are kept, never deleted.** They are examples of what not to make.
- **Installs need the owner's OK.** Any new model or tool (for example stem separation or a word aligner) is proposed first and installed only after the owner agrees.
- **No hearing claims.** Measured features describe the audio; only the owner's listening judges whether it is good. Ratings are the owner's taste, labelled as such.

## Inputs

- The working app (owner-local): Create panel with presets, 2-step vocals and lyrics, take library with ratings, Rate mode, Fix a part, ✂ Grab a section, Stitch, saved setups, and a roadmap of later work.
- [EUTONOS Studio](../STUDIO_APP.md): its Produce tab can call Music Studio when it is running.
- [Audio analysis prototype](../AUDIO_ANALYSIS.md): offline WAV measurement already in this repository.

## Slices — proposed order

| Slice | Where | Dependency | Checked outcome |
| --- | --- | --- | --- |
| **EMS-S01** Rated-takes export | PC | none | One command or button exports every rated take into ❤️ / 👍 / 👎 sets: audio stays local; a manifest per set records recipe, rating, duration, tempo/key when known and hashes. Defines the handoff format EMF reads (see EMF-S16). |
| **EMS-S02** ✨ Polish | PC | none | One-click mastering of a finished take (loudness target, gentle EQ and limiting) saved as a new take with lineage. Before/after loudness measured; owner listening judges it. |
| **EMS-S03** Snap sections to bars | PC | none | ✂ Grab a section and Fix a part can snap to the take's beat grid. Checks show cut points on beat boundaries. |
| **EMS-S04** Song analyzer and sound database | PC (+ repo for shared code) | EMS-S01 | Measure every exported take with the repository's analysis code; store features beside ratings; report which measured features differ between ❤️ / 👍 / 👎. Correlation only, labelled as such. |
| **EMS-S05** Stems | PC | owner approves the install | Offline stem separation (vocals, drums, bass, other) per take, kept local. Feeds DJ stem transitions (EMF-S15) and lyric timing (EMS-S06). |
| **EMS-S06** Visuals and synced lyrics | PC | EMS-S05 recommended | Fullscreen audio-reactive visuals, lyrics timed to the **sung** words stored as data with method and confidence, an automatic re-time pass, then MP4 export. Timing shown as approximate until a method is trusted. |

Slices may be reordered or split by the owner. Each slice ends with the [repository handoff and mini chat handoff](../WORK_MODEL.md#per-slice-handoff-policy) in this repository, recording what changed in the owner-local app without copying private material.

## Completion criteria

| Check ID | Required result | State |
| --- | --- | --- |
| EMS-C01 | Rated takes export reproducibly in a documented format EMF can read | Pending |
| EMS-C02 | At least one finishing step (Polish) produces a new take with lineage and measured before/after | Pending |
| EMS-C03 | The analyzer reports measured differences between rating sets, without claiming taste | Pending |
| EMS-C04 | Lyric timing data exists per take with method and confidence, and can be re-timed automatically | Pending |
| EMS-C05 | Owner accepts the finished workflow by listening and using it | Pending |

## Resume and closeout

Read this file, [Current Tasks](../CURRENT_TASKS.md) and the selected slice. Inspect the owner-local app's own history before changing it. Report what changed, what was checked, what is owner-local and what was published.
