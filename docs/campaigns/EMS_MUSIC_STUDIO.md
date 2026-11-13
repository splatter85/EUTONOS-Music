# EMS — Music Studio

Campaign ID: `campaign-ems-001`  
Short ID: `EMS`  
Document ID: `EM-D028`  
Owner document: this file  
Status: **PLANNED - backlog recorded; no slice assigned**  
Recorded 2026-11-12, America/Chicago; arranger slices EMS-S07 to S12 added 2026-11-13

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
- [Arranger proposal](../proposals/STUDIO_ARRANGER.md) (EM-D030) and [its research](../proposals/STUDIO_ARRANGER_RESEARCH.md) (EM-D031): recipe modes, timeline, region edits, the DJ as co-producer and quality passes. Includes the 2026-11-13 timeline spike: two bar-snapped repaints took about 4 s each and kept the rest of the song identical apart from level.

## Slices — proposed order

| Slice | Where | Dependency | Checked outcome |
| --- | --- | --- | --- |
| **EMS-S01** Rated-takes export | PC | none | One command or button exports every rated take into ❤️ / 👍 / 👎 sets: audio stays local; a manifest per set records recipe, rating, duration, tempo/key when known and hashes. Defines the handoff format EMF reads (see EMF-S16). |
| **EMS-S02** ✨ Polish | PC | none | One-click mastering of a finished take (loudness target, gentle EQ and limiting) saved as a new take with lineage. Before/after loudness measured; owner listening judges it. |
| **EMS-S03** Snap sections to bars | PC (+ repo) | none; shares downbeat work with EMF-S15 | ✂ Grab a section and Fix a part can snap to the take's bar grid. The DJ analysis is exposed as a small Node command that writes JSON and Music Studio calls it (one implementation). Checks show cut points on bar lines and report downbeat confidence. |
| **EMS-S04** Song analyzer and sound database | PC (+ repo for shared code) | EMS-S01 | Measure every exported take with the repository's analysis code; store features beside ratings; report which measured features differ between ❤️ / 👍 / 👎. Correlation only, labelled as such. |
| **EMS-S05** Stems | PC | owner approves the install | Offline stem separation (vocals, drums, bass, other) per take, kept local. Feeds DJ stem transitions (EMF-S15), vocals-louder/music-quieter region edits (EMS-S09) and lyric timing (EMS-S06). |
| **EMS-S06** Visuals and synced lyrics | PC | EMS-S05 recommended | Fullscreen audio-reactive visuals, lyrics timed to the **sung** words stored as data with method and confidence, an automatic re-time pass, then MP4 export. Timing shown as approximate until a method is trusted. |

| **EMS-S07** Song Plan and Intermediate song sheet | PC (+ repo for the schema) | none | One versioned Song Plan (`studio.song-plan.v1`: global style, sections in bars with vocal mode, energy, style and lyrics; cues; references) behind all three modes. Beginner saves a minimal plan. Intermediate is a section sheet with AI help (Write it for me, Connect the words, Fit the lyrics, Make it flow) shown as a reversible diff, local planner by default. It compiles to tagged lyrics and a caption. Owner A/B against Beginner on the same seeds. |
| **EMS-S08** Region edits I: exact mix changes | PC | EMS-S03 | Select a bar-snapped range: quieter, louder, fade, stop, darker/brighter, filter sweep, as gain/filter automation with short ramps. New take with lineage. Checks measure the gain change inside the range and an unchanged signal outside it. |
| **EMS-S09** Region edits II: AI rewrite, add and remove | PC | EMS-S03, EMS-S05 for stem edits | Rewrite this part (repaint, with only that window's lyric lines), make this a buildup or drop (2 scored candidates plus automation), add an instrument (lego on XL Base), remove an instrument and vocals louder/quieter (stems). Every pass is gain-matched to its source outside the window. A/B of candidates; each chip shows whether it is approximate or exact. |
| **EMS-S10** Timeline arranger (Advanced) | PC | EMS-S07, EMS-S08, EMS-S09 | Bar ruler, Sections, Lyrics, Energy, Moments, Instruments and Vocals lanes, plus a palette of draggable blocks and references. "Realize the plan": generate, measure, align, bar-snapped corrective repaints, exact mix cues, Polish. Lineage records every pass. Each block reports target against measured result. Owner judges by listening. |
| **EMS-S11** DJ in the studio | PC (+ repo) | EMS-S03; uses EMF-S14/S15 code | Stitch becomes a beatmatched DJ transition with an optional seam repaint. Blend two takes or sections that the analysis finds compatible on the timeline, with model-filled seams and an optional glue pass. Find similar. DJ energy templates as starting curves. |
| **EMS-S12** Quality passes and model options | PC | owner approves downloads | Final-quality settings (XL SFT or Base, 50-64 steps, documented quality options, DCW A/B); best-of-N with a published aesthetics scorer tracked against ratings; Polish with a reference; LoRA on loved takes after EMS-S01; optional owner A/B of YuE2 or HeartMuLa. Each install proposed first. |

**Recommended order after EMS-S01:** S03 → S07 → S08 → S05 → S09 → S10 → S11, with S12 in parallel from the start; S02, S04 and S06 as the owner chooses. The arranger proposal (section 11) explains the order.

Slices may be reordered or split by the owner. Each slice ends with the [repository handoff and mini chat handoff](../WORK_MODEL.md#per-slice-handoff-policy) in this repository, recording what changed in the owner-local app without copying private material.

## Completion criteria

| Check ID | Required result | State |
| --- | --- | --- |
| EMS-C01 | Rated takes export reproducibly in a documented format EMF can read | Pending |
| EMS-C02 | At least one finishing step (Polish) produces a new take with lineage and measured before/after | Pending |
| EMS-C03 | The analyzer reports measured differences between rating sets, without claiming taste | Pending |
| EMS-C04 | Lyric timing data exists per take with method and confidence, and can be re-timed automatically | Pending |
| EMS-C05 | Owner accepts the finished workflow by listening and using it | Pending |
| EMS-C06 | A Song Plan round-trips between Beginner, Intermediate and Advanced without losing data | Pending |
| EMS-C07 | Region edits leave audio outside the range unchanged (measured) and record mechanism and lineage | Pending |
| EMS-C08 | The timeline places at least buildup, drop, vocal and no-vocal blocks on their bars, with target against measured result shown; owner judges by listening | Pending |
| EMS-C09 | Two takes can be blended into a new take through DJ analysis and beatmatched seams | Pending |

## Resume and closeout

Read this file, [Current Tasks](../CURRENT_TASKS.md) and the selected slice. Inspect the owner-local app's own history before changing it. Report what changed, what was checked, what is owner-local and what was published.
