# Unified FL Studio control for Codex and Claude

Document ID: `EM-D017`  
Status: **architecture and operating guide only**, 2026-11-03. Nothing described here has been installed or verified on the owner's FL Studio machine.

**Producer seam after S01:** emit PCM16 WAV and metadata through the [portable v0 pack contract](S01_FOUNDATION.md); do not invent a separate PC pack or DJ interface. S08 may begin on Windows after S01 publication while cloud S02–S07 continue independently. The shared music system targets Windows, macOS and Linux; the Windows UI/export mechanisms below are host-specific candidates, not cross-platform FL capability claims.

## Decision: MCP first; optional visual controller

Both Codex and Claude Code use **one EUTONOS Music MCP server** to control FL Studio. MCP is the agent-facing interface, not a new sound engine. It routes work to a single installed FL Studio session. An optional user-facing controller (web, desktop, or even VB.NET) uses the same operations; **Visual Basic is not a prerequisite or a second automation stack**.

The goal is broad, practical control over creating, editing, arranging, mixing, rendering and revising music. The promise is **discoverable, honest capabilities**, not a false universal FL Studio API. Existing MCP servers are components/research sources, not services to install simultaneously.

```text
Codex / Claude Code / optional visual UI
                  |
      EUTONOS Music MCP server
      (capabilities, plans, locks,
      verification, undo/recovery)
                  |
      ONE FL Studio session broker
        |          |          |
  MIDI Python   Piano roll   UI automation
   controls      scripts     (missing APIs)
        \          |          /
         saved project + official
         CLI/UI render + file checks
                  |
        verified original sounds
                  |
       procedural engine and DJ
```

The DJ/player is independent: imported music must play after FL, Claude, Codex and the authoring bridge are closed.

## What control routes actually cover

| Requested task | First route | Missing capability and fallback |
| --- | --- | --- |
| Read transport, tempo, channels, patterns, mixer and loaded plugins | FL official Python MIDI-controller scripting | Query the *installed* API, selected target and plugin parameter availability |
| Write chords, melodies, drums, velocity and articulations | Piano roll `.pyscript` or supported step-sequencer calls; MIDI import | Read back persistent notes; live MIDI notes are only previews |
| Adjust mixing, routing, plugin parameters and presets | Official controller scripting on existing loaded plugins | Parameter names/ranges can be opaque; verify actual values and audible results |
| Create channels, instantiate plugins, load samples | Targeted, tested Windows GUI automation or prepared project templates | The normal FL scripting API does not expose broad creation/loading operations |
| Place pattern/audio clips in Playlist | Tested GUI automation or prepared arrangement templates | Controller API cannot arbitrarily place clips; inspect their actual resulting positions |
| Save/export recordings and stems | **Official documented FL command-line rendering** of a saved project; export UI fallback | Check FL build, render settings, files, duration, audio, effect tails and provenance |
| Higher-level native editing beyond official Python limits | Later optional evaluation of C#/native bridge | Version compatibility and safety must be proved; no raw-memory/plugin injection as an unexamined default |

Image-Line primary documentation: [MIDI Python scripting](https://www.image-line.com/fl-studio-learning/fl-studio-online-manual/html/midi_scripting.htm), [Piano roll scripting](https://www.image-line.com/fl-studio-learning/fl-studio-online-manual/html/pianoroll_scripting_api.htm), [export and Windows command-line rendering](https://www.image-line.com/fl-studio-learning/fl-studio-online-manual/html/fformats_save_export.htm).

## Upstream inventory: evaluate, don't concatenate

- [Zierax/fl-studio-mcp](https://github.com/Zierax/fl-studio-mcp): broad FL scripting coverage, patterns, plugin controls and API discovery. Strong initial **control coverage** reference; maintainer explicitly documents gaps.
- [rosasynthesiz/flstudio-mcp](https://github.com/rosasynthesiz/flstudio-mcp): mixing/diagnosis, MIDI daemon, note bridge, snapshots, readback and change log. Strong **safe mutation** reference.
- [karl-andres/fl-studio-mcp](https://github.com/karl-andres/fl-studio-mcp) and [calvinw/fl-studio-mcp](https://github.com/calvinw/fl-studio-mcp): foundational MIDI/Piano-roll bridges; many newer projects inherit their approaches.
- [kaupau/flai-mcp](https://github.com/kaupau/flai-mcp): alternative MIDI SysEx/step-sequencer control; useful if the first transport fails.
- [KindaMAD-hav/fl-studio-mcp-KindaMAD](https://github.com/KindaMAD-hav/fl-studio-mcp-KindaMAD): Windows screenshot/keyboard and Playlist arrangement pipeline, based on measured FL versions and specific screen layout. Strong **GUI gap** research; fragile until tested on the actual monitor/project.
- [geezoria/FLStudioMCP](https://github.com/geezoria/FLStudioMCP): alternative broad FL/MCP automation and composition integration.
- [Realynx/FL-Automation](https://github.com/Realynx/FL-Automation): native/C# FruityLink SDK claims more direct editing, including Playlist clips. Evaluate later as a version-sensitive optional adapter; do not infer it works on any installed FL build.

Many are forks of the same approach with overlapping tools and conflicting MIDI-port/script requirements. Start by pinning and auditing **one** baseline, selectively adapt proven mechanisms from others under their licenses, and keep only a single broker owning the FL MIDI/session resource. Tool counts and README claims are not benchmarks.

## Agent-facing tool design (proposed, not implemented)

| Tool | Verifiable result |
| --- | --- |
| `fl_capabilities` | Exact FL, plugin, bridge versions and supported/unavailable operations |
| `fl_inspect` | Project identity, selected channel, pattern, arrangement, mixer, loaded effects |
| `fl_prepare_change` | Bounded proposal, expected revision, intended target and backups |
| `fl_apply_change` | Serialized mutation, caller operation ID, specific readback evidence |
| `fl_arrange` | Checked Playlist/section result, or explicit unsupported status |
| `fl_render` | Saved source revision, rendered path/hash/format/duration and audio validation |
| `fl_verify` / `fl_restore` | Inspect result or safely restore a backed-up project |
| `fl_register_asset` | A reviewed original sound/loop/stem eligible for the generator and DJ |
| `fl_operation_status` | Reconcile a lost receipt using original operation ID |

Do not expose arbitrary `eval`, unrestricted Python execution, raw GUI clicks, or access to the whole filesystem as the default agent toolkit. If developer diagnostics are necessary, gate them explicitly to a disposable project, permitted directories, a trusted interactive user and a confirmed FL build. Do not claim that an agent “heard” audio unless actual listening evidence exists.

## How to use it: a repeatable workflow

1. **Set up once.** Verify FL Studio version/edition, its actual script directories, available local synths/sounds and virtual MIDI transport. In a **disposable FL project**, install only the one selected audited bridge. Preserve its original code and license. Set one project writer, with backups.
2. **Connect clients.** Register the *same EUTONOS Music MCP facade* in Codex and Claude Code, with one persistent local session broker. For the eventual implemented executable use the patterns `codex mcp add eutonos-music -- <launcher>` and `claude mcp add eutonos-music -- <launcher>`; confirm flags against installed client help. Verify `codex mcp list` / `claude mcp list` and a non-mutating `fl_capabilities` request. These placeholders are **not runnable until a launcher exists**.
3. **Describe the sound.** Example: “Use my available FL synths to produce dark progressive house at 124 BPM, a four-bar drum motif, an eight-bar bass part, chord variations, one fill and an intro/outro. Keep it editable and render aligned stems.”
4. **Inspect and plan.** Agent selects real loaded instruments, confirms target and revision, explains which actions are API-supported, UI-assisted or need an explicit producer step. No hidden claim of unattended plugin insertion.
5. **Apply and verify.** Agent creates notes/patterns and optionally arrangement using proven routes. Read back actual result, save a project copy, render with tested CLI/UI, inspect files, preview and log failures. When a write times out, query its original operation ID before retrying.
6. **Listen and refine.** Compare the actual sounds/versions, adjust composition/sound/mix, and only admit reviewed outputs into the procedural palette or DJ library.
7. **Play independently.** The EUTONOS player uses imported assets, without relying on the authoring MCP, FL Studio or model latency.

## First implementation checks

**A.** Both Codex and Claude can inspect the *same* running FL session with no port contention.  
**B.** One agent creates and reads back an editable eight-bar multi-part pattern.  
**C.** One arrangement step works, either via approved GUI automation or a prepared project template.  
**D.** One saved project is rendered with the verified official CLI/UI path; its WAV/stems are checked and audible.  
**E.** The resulting sound is used in one evolving procedural recipe and DJ transition.

Stop and report what requires manual FL action rather than claiming “complete FL control.” The initial system can work before every missing API operation is automated. Later adapters expand only the actual gaps discovered in a realistic composition exercise.

The fuller preexisting research and project/rollback constraints remain in [FL Studio integration](FL_STUDIO_INTEGRATION.md).
