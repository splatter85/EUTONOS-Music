# EMS-S07 — slice handoff: Song Plan and Intermediate song sheet

**Campaign:** EMS / `campaign-ems-001`  
**Slice:** EMS-S07 Song Plan and Intermediate song sheet  
**Disposition:** PAUSED on owner acceptance. The implementation is built, checked and committed. The slice's own acceptance step, an owner A/B of the song sheet against Beginner on the same seeds, has not happened.  
**Environment:** PC. Windows 11, Python 3.13 (Music Studio venv), ACE-Step 1.5 XL Turbo on an RTX 5090. macOS and Linux were not run.  
**Source:** Music Studio is owner-local with no remote; its commit `35a9c0a` is on its own `main`. The repository holds this handoff, the [example plan](../examples/song-plan.example.json) and the doc updates in the commit that adds this handoff, on top of `e4d4baa`.  
**Publication:** the repository commit is pushed; Music Studio stays local by design.

## Assignment and scope

From [EMS](../campaigns/EMS_MUSIC_STUDIO.md) and [the arranger proposal](../proposals/STUDIO_ARRANGER.md), sections 4–6:
- One versioned Song Plan behind all three modes.
- Beginner saves a minimal plan.
- Intermediate is a section sheet with AI help shown as a reversible diff, using the local planner by default.
- It compiles to tagged lyrics and a caption.
- Owner A/B against Beginner on the same seeds.

Out of scope: cues and references are carried as data but not realized (EMS-S08 to S10); the Advanced timeline (EMS-S10); an optional Claude-written sheet.

## Delivered changes

**Song Plan `studio.song-plan.v1`** (Music Studio module, data only, never instructions):
- **`validate`** normalizes and refuses bad plans with a readable reason:
  - Kinds: intro, verse, pre-chorus, chorus, post-chorus, bridge, buildup, drop, breakdown, instrumental, solo, hook, outro.
  - Vocal modes: none, whisper, soft, full, backing.
  - Energy is a whole number 0–10; bars are 1–64 per section and 400 in total.
  - Size limits: style 160 characters, lyrics 1,500 per section and 6,000 in total, up to 32 sections.
  - Section ids must be unique.
- **`compile_plan`** turns sections into what ACE-Step reads:
  - One tag per section with descriptors, for example `[Buildup - instrumental, no vocals, driving, building intensity, riser, snare roll]`.
  - A section is sung when its vocal mode is not "none" and it has lyrics. Only sung sections get a vocal descriptor and their lyric lines; others are tagged instrumental. Stray `[...]` lines in lyrics are dropped, and `[` and `]` cannot be injected through the style text.
  - Length is total bars × 4 beats × 60 / BPM and must fall in 10–600 s.
  - Instrumental means no section is sung.
  - It also returns each section's start bar and seconds.
- **`minimal`**: the Beginner plan (global style only) saved with every take made from picks.
- **Generation:**
  - `POST /api/generate` accepts `plan`. With sections, the compiled lyrics, length and vocal flag replace the request's own, at the request's BPM. A 10 s preview keeps its length, compiles only the parts that start within it and saves a style-only plan.
  - For edits (modify, extend, repaint) the plan is kept as data and not recompiled.
  - The compiled structure is sent as the model's lyrics even for an instrumental sheet, so its tags still shape the song.
  - The plan is saved on the take as `plan`. Inside the request it travels as `song_plan`, because `plan` already names the favorites batch list.
- **`POST /api/plan/compile`** previews what a plan sends to the model.

**Song sheet UI** (Create panel, optional module):
- **Starting point:** pick a shape (Song, Club track, Short song) or add parts one by one.
- **Section cards:** each has a kind, bars, a vocal mode, an energy slider, a sound line and lyrics (shown when sung). A card can be repeated (⧉), moved with ↑/↓ or by dragging its grip, or removed. Each card shows its bar range and time.
- **Generate:** while the sheet has parts, Generate follows it, and **What the model gets** shows the compiled text.
- **Helpers:** each one shows a list of changes with **Keep** or **↶ Undo**.
  - **✍ Write it for me** calls ACE-Step's local 5Hz planner through the existing lyrics route. It parses the tagged lyrics into parts, or fills the empty sung parts of an existing sheet, then lengthens parts to fit.
  - **🔗 Connect the words** is a rule, not AI. It gives empty parts a sound that suits their kind and flags clashing picks, for example lo-fi with a crisp modern master.
  - **📏 Fit the lyrics** is a rule. It allows about one line per 2 bars, rounded up to 4 bars, and turns vocals on for parts that have lyrics.
  - **🌊 Make it flow** is a rule. It sets energy by kind, inserts a 4-bar buildup or pre-chorus before a drop or chorus that jumps 3 or more, and softens a loud last part.
- **Round trip:** **⋯ → Open its song sheet** on a take loads its plan back into Create, together with its BPM.
- **Saving:** the sheet is kept in the browser between visits.

A publishable [example plan](../examples/song-plan.example.json) is in the repository; takes and audio stay owner-local.

## Verification and limits

| Check | Result | Evidence / limit |
| --- | --- | --- |
| Song Plan unit tests (`python -m unittest discover -s tests` in Music Studio) | PASS, 12 tests | Compile output and bar starts; instrumental sheet keeps structure; unsung lyrics dropped; vocal tag only when sung; preview truncation; request BPM wins; id collisions; cue cap; tag injection; 9 invalid plans refused; Beginner and Intermediate plans round-trip |
| `POST /api/plan/compile` | Correct tags, 54.194 s for 28 bars at 124 BPM; bad profile → 400 with reason | |
| Browser (built-in browser, Music Studio page) | Club shape → 7 parts, 96 bars, 3:12; repeat, kind and vocal change; Fit (8 → 16 bars for 7 lines); Flow (energy reset plus inserted buildup); Undo restored the exact previous sheet; Connect; request carried the plan with 240 s; Open its song sheet restored 4 parts, 36 bars, 124 BPM; What the model gets matched | Driven by script, not by hand; layout checked by screenshot |
| One real generation from a sheet (intro 8, buildup 4, drop 16, outro 8 at 124 BPM, seed 424242, XL Turbo, planner off) | Done in 60 s including engine start; take saved the plan; the engine got the four tags; length 69.677 s | One seed |
| Measured loudness per planned part of that take (125 BPM measured grid) | Intro −22.9, buildup −19.0, drop −15.6, outro −17.3 dB RMS | Rises as planned; the outro is not as quiet as asked. Measurement only, one seed |
| Independent review (separate agent, read-only) | Findings fixed before commit: vocal tags only for sung parts; a 10 s preview compiles only its opening parts and saves a style-only plan; the request BPM wins over the plan BPM; default ids cannot collide with explicit ones; cues and references are size-capped; the sheet request no longer sends placeholder lyrics; extending a preview compiles the sheet first; pasted section names are normalized; manual edits clear Undo; stored values are type-checked; changing BPM re-renders the sheet | Server restarted and rechecked: compile tags an unsung intro as instrumental; the sheet request carried the plan, no lyrics, 48 s for 24 bars |
| Owner A/B against Beginner on the same seeds | **NOT DONE** | The slice's acceptance step |

**Audio:** one take was rendered. Nothing was played on physical output or heard by the agent. Measured loudness is not a judgement of quality.

**Bug found and fixed during testing:** the first sheet generation failed with error "0". The job runner already uses `req["plan"]` for the favorites batch list, so the song plan now travels as `song_plan`.

## Decisions, risks and recovery

- **The compiled structure goes to the model even when the sheet is instrumental.** That is the point of the sheet: the old path sent only `[instrumental]`.
- **Three of the four helpers are rules, not AI,** and the UI says so. Only Write it for me calls the planner model. Claude-written sheets remain optional later work, as in the proposal.
- **No owner judgement yet.** The proposal expects the sheet to beat appended words. Only an A/B by ear on the same seeds can show that.
- **The tempo drift from EMS-S03 applies here too.** A plan at 124 BPM rendered at about 125, so the planned section times are a few hundred ms early by the end. The Advanced timeline (EMS-S10) will correct this with the measured grid.
- Recovery: "Stop using the sheet" returns Create to the simple way. Takes made before this slice have no plan and are unaffected.

## Next handoff

**Owner action (accepts S07):** In Create, pick the same words twice with a fixed seed (Advanced → Seed). Generate once the simple way, then open **Song sheet**, start from a shape and Generate again. Compare by ear and rate both.  
**Exactly one next actionable slice:** EMS-S08 Region edits I (exact mix changes), PC, after the owner's A/B.  
**Still not done:** owner A/B; cues and references are not realized yet; Advanced mode (EMS-S10).

## Closeout

The campaign, board and [Current Tasks](../CURRENT_TASKS.md) are updated. The repository commit is pushed; Music Studio is local only.
