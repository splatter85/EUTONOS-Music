# EMD — DJ app (human-facing GUI)

Campaign ID: `campaign-emd-001`  
Short ID: `EMD`  
Document ID: `EM-D029`  
Owner document: this file  
Status: **PLANNED - waits for the EMF DJ engine to be listened to and connected to Mission Control**  
Recorded 2026-11-12, America/Chicago

Progress estimate: **unknown**. No slice has started. The existing [EUTONOS Studio](../STUDIO_APP.md) page is a working starting point, not this campaign's result.

## Outcome

A polished, human-facing DJ app that a person can use on its own: load and browse music, watch the decks, choose and steer transitions, and hand requests to the DJ. It runs on the same DJ engine and state/request interface that Mission Control uses, so there is still **one DJ and one playback owner**, never a second engine.

It belongs to the same ecosystem as [EMF](EMF_INITIAL_INFRASTRUCTURE.md) (engine, transitions and Mission Control adapter) and [EMS](EMS_MUSIC_STUDIO.md) (Music Studio, the generation and rating app). See [EM-DEC036](../DECISIONS.md).

## Order and dependencies

1. EMF makes the DJ's transitions good (EMF-S14, EMF-S15) and the owner listens (EMF-S10).
2. EMF connects Mission Control to the DJ's state/request interface (EMF-S12).
3. **Then** this campaign puts the human GUI on that same interface. Design work (EMD-S01) may start earlier because it changes no engine code.

## Scope and boundaries

- Browser-first and portable (Windows, macOS, Linux). Any desktop wrapper is a later, separate decision.
- Style of high-end DJ software, not its complexity. Simple by default, detail on demand.
- The GUI only sends requests and shows state. It never schedules audio itself (one clock, one owner).
- Show requested, prepared and audible state separately, and respect mute, Hold and transport.
- Builds on the EUTONOS Studio page where that helps; the S09 DJ demo page stays available for comparison.

## Slices — proposed order

| Slice | Where | Dependency | Checked outcome |
| --- | --- | --- | --- |
| **EMD-S01** Design brief and mockups | CLOUD or PC | none | Screens for decks, mixer strip, transition controls, library and request queue; reviewed by the owner before build. No engine code. |
| **EMD-S02** App shell on the shared interface | PC/CLOUD | EMF-S12 | Standalone app that reads the same state/request API as Mission Control; browser checks prove it only sends requests. |
| **EMD-S03** Decks, mixer and transition controls | PC/CLOUD | EMD-S02, EMF-S15 | Waveforms with analysed mix points, tempo/key readouts, transition style choice (Crossfade, Bridge, Beatmatch and later styles), live but plan-safe EQ/filter display. |
| **EMD-S04** Library and Music Studio link | PC | EMD-S02, EMS-S01 | Browse packs and exported rated takes; send to deck or queue; optional link to Music Studio for new material. |
| **EMD-S05** Owner usability and listening acceptance | PC + owner | EMD-S03–S04 | Owner uses the app for a real session and accepts or revises it. |

Every slice ends with the [repository handoff and mini chat handoff](../WORK_MODEL.md#per-slice-handoff-policy).

## Completion criteria

| Check ID | Required result | State |
| --- | --- | --- |
| EMD-C01 | The app drives the same DJ interface as Mission Control, with no second playback owner | Pending |
| EMD-C02 | Requested, prepared and audible state are visible and distinct | Pending |
| EMD-C03 | Transition styles and their analysed parameters are visible and selectable | Pending |
| EMD-C04 | Browser checks pass on each OS actually run; untested OSes are reported as untested | Pending |
| EMD-C05 | Owner accepts the app after a real listening session | Pending |

## Resume and closeout

Read this file, the EMF campaign's current checkpoint and [Current Tasks](../CURRENT_TASKS.md). Confirm EMF-S12's interface state before building on it.
