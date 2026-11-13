# Music Studio arranger: recipe modes, timeline, region edits and the DJ as co-producer

Document ID: `EM-D030`  
Status: **PROPOSAL - planned in [EMS](../campaigns/EMS_MUSIC_STUDIO.md) slices EMS-S07 to EMS-S12; one engineering spike run, nothing built, nothing heard by the agent**  
Recorded 2026-11-13, America/Chicago. Research: [EM-D031](STUDIO_ARRANGER_RESEARCH.md).

## 1. What the owner asked for

These are the owner's words, condensed:

- **A drag-and-drop prompt builder.** You get a timeline and drag features onto it, and the song makes those things happen around where you drop them:
  - lyrics in some parts but not others;
  - sections where it gets louder;
  - a drop, a buildup;
  - musical cues like heavy bass or quiet singing.
- **Three levels of recipe building:**
  - Beginner is today's mode: words appended to a recipe.
  - Intermediate makes better connections between the words, and AI helps write the recipe.
  - Advanced is the timeline. The intermediate recipe is broken into chunks you place on the timeline, plus musical cues you drag and drop.
- **Region edits on a finished song.** Select a section and say "quiet the music" or "make the vocals louder", and similar.
- **Bring in the DJ.** Use DJ features in the studio and involve the DJ in creating music. Stitch together two similar-sounding songs, or sections of them, to make a new one.
- **Quality.** Look at more powerful local models, and let the current model do extra passes for better quality.
- **What else is out there?** Survey the tools and features for modifying, layering or removing things from songs with AI.

The owner wants control of the song's **flow**, not just its ingredients.

## 2. What is possible, in one paragraph

The local model (ACE-Step 1.5) cannot take "this tag at this second". It does follow section tags in the lyrics (`[Verse - whispered]`, `[Instrumental]`, `[Chorus - anthemic]`), but it decides where they land. Exact placement comes from a second tool it already has: **repaint**, which regenerates only a chosen time window and keeps the rest.

So the timeline works as a plan that is realized in passes:

1. One full generation from the plan.
2. Measure where the bars and sections actually fell.
3. Bar-snapped repaints for each block that must sit at a specific place.
4. Exact mix changes (louder, quieter, vocals up) through plain gain automation, or per-stem gain once stems exist.

The DJ's beat analysis provides the bar grid. The DJ's transition engine stitches songs together on bar lines.

## 3. Evidence so far: the timeline spike (2026-11-13, owner PC)

**Run:** Music Studio API with the XL Turbo model, RTX 5090. Everything stays owner-local.

| Step | What was asked | Time | Result (measured, not heard) |
| --- | --- | --- | --- |
| Base | 78 s melodic deep house, 124 BPM, A minor. Structure-tagged lyrics: `[Intro - instrumental]`, `[Verse - soft, close vocal]`, `[Chorus - full, open vocal]`, `[Instrumental - groove]`, `[Outro - instrumental]` | 47 s, including the planner's thinking | The DJ analysis found about 125 BPM (requested 124), beat confidence 0.56, **downbeat confidence 0.06**. A clear energy step at bar 25 (about 46.5 s), from about -16 to -12 dB per bar. |
| Buildup | Repaint bars 21–24 (38.74–46.49 s on the requested 124 BPM grid): "rising riser, accelerating snare roll, filter opening, kick drops out" | **4.6 s** | Outside the window the audio is identical apart from one level change of the whole file: gain-matched residual -129 dB, level shift 0.42 dB. Inside the window, per-bar loudness **did not rise** across the four bars. |
| Drop | Repaint bars 25–32 of the buildup take: "heavy rolling sub bass, kick back in, full energy, big synth hook" | **3.6 s** | Outside the window it is again identical apart from level (residual -127 dB, shift 1.00 dB). Gain-corrected, the drop region is about as loud as the original material (about -12 dB per bar). It is not measurably bigger. |

**What this shows:**

1. **The core mechanism works and is fast.** A bar-snapped repaint takes about 4 seconds, so a timeline of 5–10 placed blocks is under a minute of GPU time after the first pass.
2. **Repaint preserves everything outside the window.** But every pass renormalizes the whole file. Chained edits drift in level (here 1.4 dB after two passes), so the arranger must **gain-match each pass back to its source outside the window**. That is exact, since only gain differs.
3. **Words alone do not guarantee energy.** "Buildup" and "drop" did not raise measured loudness. Energy shapes need either several candidates scored by measured energy, or exact gain/filter automation, or both. Whether the riser or the bass are audible at all is for the owner's ears.
4. **Bar lines need better downbeat detection.** Tempo was close, but downbeat confidence was 0.06. Requesting a BPM keeps the grid steady, but its phase must be found reliably. That is the same problem as [EMF-S15](../campaigns/EMF_INITIAL_INFRASTRUCTURE.md), so the work is shared.
   **Correction (2026-11-13, EMS-S03):** the requested BPM is not the rendered BPM. A fine onset fit measures this take at **125.000 BPM**, not 124, and a second take requested at 124 also measured 125. The spike's repaint windows were placed on the 124 grid, so by bar 21 to bar 32 they sat up to about 0.4 s off the measured bar lines. EMS-S03's bar-grid command measures the grid from the audio, so snapping now uses measured bar lines; the requested BPM is only a search hint.
5. **A repaint replaces vocals in its window.** The drop was asked for as instrumental, so any chorus vocals inside bars 25–32 are gone. The timeline must show which blocks keep, replace or remove vocals.

**Owner audition path:** in Music Studio's library, compare "Timeline test - base", "Timeline test - buildup" and "Timeline test - buildup + drop". Rate them as usual; 👎 keeps them.

## 4. One data model: the Song Plan

Every mode edits the same versioned document, so you can move between modes without losing work.

```json
{
  "profile": "studio.song-plan.v1",
  "global": {"style": "melodic deep house, warm pads", "genres": ["deep house"], "moods": ["warm"],
             "bpm": 124, "key": "A minor", "vocal_language": "en", "model": "xl-turbo", "seed": 424242},
  "sections": [
    {"id": "s1", "kind": "intro", "bars": 8, "vocal": "none", "energy": 3, "style": "filtered pads"},
    {"id": "s2", "kind": "verse", "bars": 16, "vocal": "soft", "energy": 4, "lyrics": "City lights are folding into blue…"},
    {"id": "s3", "kind": "buildup", "bars": 4, "vocal": "none", "energy": 7, "style": "riser, snare roll"},
    {"id": "s4", "kind": "drop", "bars": 16, "vocal": "none", "energy": 9, "style": "heavy sub bass"}
  ],
  "cues": [
    {"id": "c1", "type": "vocals-louder", "start_bar": 9, "bars": 8, "amount_db": 3},
    {"id": "c2", "type": "music-quieter", "start_bar": 9, "bars": 8, "amount_db": -4},
    {"id": "c3", "type": "add-instrument", "start_bar": 29, "bars": 16, "instrument": "strings"}
  ],
  "references": [{"id": "r1", "take_id": "…", "start_bar": 17, "bars": 8, "use": "sounds-like"}]
}
```

**Sections** are the song's form. Each has a kind, a length in bars, a vocal mode, a target energy, an optional style fragment and optional lyrics.

**Cues** are overlay blocks on lanes. Each carries the mechanism that will realize it (see section 8), and the UI shows that mechanism.

**Time is in bars.** It is converted to seconds through the requested BPM, then corrected by the measured beat grid after the first pass.

The plan is safe data and can be published as a schema. Takes and audio stay owner-local.

## 5. Beginner mode (today)

- Keep it as it is: pick words and presets, generate.
- Behind the scenes it now saves a minimal Song Plan with global style and no sections, so any take can be opened in a higher mode later.

## 6. Intermediate mode: the song sheet

A vertical sheet of sections, which is the familiar lyric-sheet shape:

- **Global line:** style, genres, moods, BPM, key, length, model. Each picked word becomes a chip with a slot (genre, instrument, mood, production, vocal), rather than a flat list.
- **Section cards:** kind, bars, vocal mode (none, whisper, soft, full, backing only), energy 0–10, style fragment, lyrics. Drag cards to reorder. Duplicate a card to repeat a chorus.
- **AI help buttons.** Each shows a before/after diff and can be undone:
  - **Write it for me.** A one-line idea becomes a full sheet: sections, lyrics, style.
  - **Connect the words.** Turn the pile of picked words into one coherent caption and consistent section descriptors, removing clashes such as "lo-fi" with "crisp modern master".
  - **Fit the lyrics.** Split and trim lyrics so each section's lines fit its bars at the tempo.
  - **Make it flow.** Propose an energy arc (intro low, build, peak, release) and matching section kinds.
- **Who writes:**
  - Default is local: ACE-Step's own planner can already turn a short description into caption, lyrics, BPM and key ("create sample" and "format" functions in its docs).
  - Optional: a Claude call, only if the owner adds a key, and labelled when used.
  - Either way the output is data that the owner reviews. It is never instructions to the app.
- **Compile to the model:**
  - The caption comes from the global line.
  - The lyrics field gets tagged sections with descriptors, for example `[Buildup - rising, snare roll]` and `[Drop - heavy bass, no vocals]`.
  - Duration is the sum of bars times the bar length.
  - This alone should beat today's appended words. Measure that by owner A/B, not by assumption.

## 7. Advanced mode: the timeline arranger

**Layout:**
- A bar ruler with time underneath.
- A **Sections lane**: blocks from the sheet, resized in whole bars.
- A **Lyrics lane**: lyric chunks dragged onto sections. A section with no chunk is instrumental.
- Four cue lanes:
  - **Energy:** draw a curve or drop energy blocks.
  - **Moments:** buildup, drop, riser, stop or silence, impact, filter sweep.
  - **Instruments:** heavy bass, add strings or other instruments, remove drums.
  - **Vocals:** quiet singing, vocals louder, no vocals, backing only.
- A **palette** sidebar holds draggable blocks, plus **references**: drag a section of an existing take as "sounds like this", or as real audio to keep.

**Realize the plan** is the render pipeline, every step recorded in the take's lineage:

1. **Compile and generate** the whole song from the sheet (section 6). Use 2–4 seeds when quality matters (section 10).
2. **Measure.** Find the beat grid and downbeats (shared EMF-S15 code), loudness and low-band energy per bar, section boundaries, and vocal presence (with stems, EMS-S05).
3. **Align.** Map plan bars to measured bars. Report any section the model placed differently.
4. **Correct with repaints.** Repaint each block that misses its target (wrong place, vocals where none were wanted, energy too low) on its exact bars, with its local style. Make 2 candidates and keep the one whose measured result best matches the block. Gain-match every pass to its source outside the window. The owner can A/B any block.
5. **Exact mix cues.**
   - Louder or quieter sections, fades, stops and filter sweeps are gain or filter automation with short ramps on bar lines.
   - Vocals louder or quieter and music quieter use per-stem gain once stems exist. Until then they offer the honest whole-mix fallback.
6. **Finish.** Run Polish (EMS-S02) and save a new take whose lineage holds the plan, each pass, mechanism, seeds and measurements.

**Honesty in the UI:** each block shows a badge, either **AI regenerates this part** (approximate) or **mix change** (exact). Approximate blocks show their measured result next to the target, for example "energy target 9, measured 6: try again?".

## 8. Region edits on a finished take

Select a range on the waveform. It snaps to bars once EMS-S03 lands. Then pick a chip or type an instruction; typed text is matched to a chip by local rules, and AI is used only to interpret.

| Instruction | Mechanism | Exactness | Needs |
| --- | --- | --- | --- |
| Quieter, louder, fade in or out, stop | Gain automation with bar-line ramps | Exact | nothing new |
| Darker or brighter, filter sweep | EQ or filter automation | Exact | nothing new |
| Make the vocals louder or quieter, quiet the music | Separate stems, per-stem gain over the range, re-sum | Exact gain; separation artefacts possible | stems (EMS-S05, install needs owner OK) |
| Remove drums, bass or vocals here | Mute that stem over the range, or ACE-Step extract plus re-sum | Approximate (bleed) | stems or the XL Base model |
| Add strings, guitar or other instruments here | ACE-Step **lego** on the range | Approximate | XL Base model (already installed) |
| Rewrite this part, new lyrics here | Repaint with new style and lyrics | Approximate | nothing new |
| Make this a buildup or a drop | Repaint plus scored candidates plus gain or filter automation | Mixed | nothing new |
| Continue from here | Extend | Approximate | nothing new |
| Make the whole song sound like this part | Cover at high keep, or a reference pass | Approximate | nothing new |

Every edit becomes a new take with lineage. The original is never overwritten.

## 9. The DJ as co-producer

The EUTONOS DJ already analyses tempo, key, energy and mix points, prepares tempo- and pitch-matched renders, and swaps bass and EQ between songs ([DJ transitions](../DJ_TRANSITIONS.md)). It is used in the studio as follows:

- **Stitch, beatmatched.** Music Studio's Stitch is a plain crossfade today. Replace it with a DJ transition:
  1. Pick cue-out and cue-in points on phrases.
  2. Tempo- and pitch-match.
  3. Swap the bass.
  4. Optionally repaint across the seam so the join sounds composed rather than mixed.
- **Blend two takes into a new song.**
  1. Pick two takes, or sections of them, that the analysis says are compatible: close tempo, compatible key, similar energy.
  2. Arrange their sections on the timeline as real audio clips, for example A's verse, B's chorus, A's drop.
  3. Have the model fill the gaps and seams with repaint or extend.
  4. Optionally run a low-strength cover "glue pass" to unify the sound, and A/B it against the version without glue.
- **Find similar.** Library suggestions by measured tempo, key compatibility, energy and spectrum, for blending or for the DJ's next track.
- **DJ energy templates.** Use set-shaped arcs (warm-up, peak, cool-down) as starting energy curves on the timeline.
- **Shared code, one implementation.** Music Studio is Python and the DJ analysis is TypeScript in this repository. Expose the analysis as a small Node command-line tool that writes JSON, and have Music Studio call it, rather than port it. This keeps one implementation and one set of tests.

## 10. Quality: stronger models and extra passes

The detail is in [the research](STUDIO_ARRANGER_RESEARCH.md). In short:

- **Model.** Nothing open that we could verify clearly beats ACE-Step 1.5 XL for local full songs with vocals on this PC; every comparison found is the vendor's own claim.
  - YuE2 and HeartMuLa are candidates for an owner A/B. YuE2 has non-commercial weights and an experimental Windows path. HeartMuLa is Apache, with no editing in its main repository.
  - ACE-Step's own **XL SFT** checkpoint, which its docs call highest quality, is not installed. Downloading it needs owner approval.
- **Passes, in order of expected value.** The expected value is a judgment, not evidence; only listening decides.
  1. **Final-quality render settings:** XL SFT or Base at 50–64 steps, with the documented quality options (adaptive guidance, shift 3.0), and an A/B of the sampler correction (DCW). Music Studio sends none of these today.
  2. **Best of N:** generate 3–4 seeds, auto-rank them with a published aesthetics scorer (Meta Audiobox Aesthetics, CC-BY-4.0, or SongEval, non-commercial), and show the top first. The scorer is not the owner's taste. Track agreement with ratings.
  3. **Repaint weak sections.** This exists as "Fix a part" and becomes automatic in the arranger.
  4. **Polish:** loudness and EQ matching to a reference the owner likes (Matchering, GPL-3.0, run as a separate tool).
  5. **LoRA on loved takes**, after EMS-S01 export. It needs about 16–20 GB of VRAM and cannot run while generating.
  6. Alternate VAE (needs an engine restart) and super-resolution: low priority.

## 11. Order, slices and finish lines

These are planned in [EMS](../campaigns/EMS_MUSIC_STUDIO.md). The order builds each piece on the last:

1. **EMS-S03** snap to bars, using the shared downbeat work with EMF-S15.
2. **EMS-S07** Song Plan and Intermediate song sheet.
3. **EMS-S08** region edits I: exact mix changes.
4. **EMS-S05** stems, with owner OK, which enables vocals louder and quieter.
5. **EMS-S09** region edits II: AI rewrite, add and remove.
6. **EMS-S10** timeline arranger.
7. **EMS-S11** DJ in the studio.
8. **EMS-S12** quality passes and model options, which can run in parallel from the start.

## 12. Open questions and risks

- **Seams:** whether repaint edges are audible on bar lines. This needs owner listening; crossfaded splicing is the fallback.
- **Placement:** how reliably the first pass places tagged sections. Measure over several seeds before promising placement without repaint.
- **Downbeats:** downbeat detection on generated music. The spike measured 0.06 confidence, and it is shared with EMF-S15.
- **Separation quality:** stem separation on AI-generated music is unmeasured, and published scores are on real recordings.
- **Lyrics in repaints:** a repaint with vocals needs the right lyric lines for the window. The arranger must pass only that window's lines and keep the rest. Not yet tested.
- **Approvals:** model downloads and installs (XL SFT, stem separation, scorers) each need the owner's OK.
- **Voice cloning:** no voice conversion of real people without consent.
