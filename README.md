# EUTONOS Music

**First make a simple standalone music system work. Then connect Mission Control.**

**Status: EMF-S05 is COMPLETE** in main. The DJ can now drive recording A → a seeded procedural bridge → recording B, with checked cues, a one-bar bass/tail handoff and safe fades ([S05 guide](docs/S05_HYBRID.md)). It was built and checked on Windows: **143 Node tests, 19 native offline checks and 12 browser report groups** passed. macOS and Linux were not run for S05.

**Physical output and human listening are NOT TESTED.** The next slice is **S06** (portable importer and mock FL-producer contract), when assigned. S08 separately proves the bounded FL authoring path on Windows. [Current evidence](docs/CURRENT_TASKS.md).

**Platforms:** Windows, macOS and Linux. Windows leads the first FL Studio/MCP qualification; the shared core and pack format stay portable. There is no automatic CI: run `npm run check` and `npm run check:browser` on each OS you can reach and report which OSes actually ran. The last three-platform results are in the [S04 handoff](docs/handoffs/EMF-S04-HANDOFF.md). Physical output, other browsers and FL adapter compatibility require separate platform-specific verification.

## Run the player

Install **Node.js 24.x** (including npm), then run from a checkout on any target OS:

```sh
npm ci --ignore-scripts
npm run check
npm run demo
```

Open **http://127.0.0.1:4173/**. Press **Play**, then **Next Song** before A reaches eight seconds. B enters at 8 seconds, the four-second overlap finishes at 12 seconds, and B ends at about 24 seconds. Queue A or B before Play to choose explicitly. Pause freezes the timeline; Cancel next restores A before the handoff starts; Stop cancels audio and retains unstarted queue entries. State/genre requests select only supported material, and Hold freezes those targets. Playback starts only after an explicit Play. Hidden tabs pause until an explicit Resume. Set **Handoff** to **Procedural bridge** before Next Song to get A → bridge → B instead: the bridge enters at 8 seconds with percussion while A fades, B enters at 16 seconds, and the bridge's last percussion fades out by 18 seconds.

`check` compiles TypeScript, runs Node tests, checks deterministic fixture regeneration, and validates all six committed WAV files. `demo` starts a small loopback-only development server. No runtime npm package, DAW, model or paid service is needed. TypeScript and Playwright are development dependencies.

The demo's **Offline checks** page renders and measures the transition without speaker output. For automated browser verification, run `npx playwright install chromium` once, then `npm run check:browser`. See the [S03 controls, selection and limits](docs/S03_DJ.md).

The published S04 branch also serves **http://127.0.0.1:4173/procedural.html**. Press **Play variation** to audition seed 1, then Stop and try seed 2 or Drive. The source uses the four original sample inputs for one eight-bar performance, with exact plan replay and bounded notes/sample residency. Its native checks passed on Windows, macOS and Linux with strict replay and the original sample-error tolerance unchanged. [S04 guide and limits](docs/S04_PROCEDURAL.md).

See [the v0 format, APIs and setup guide](docs/S01_FOUNDATION.md), [fixture provenance](fixtures/s01/PROVENANCE.md), and [the fixture manifest](fixtures/s01/manifest.json). `npm run fixtures:generate` deliberately rebuilds the authored fixture pack; `npm run fixtures:check` verifies it without rewriting files.

## Three layers

1. **MCP agent production interface:** Codex and Claude share a unified EUTONOS Music MCP server that routes to the best *verified* FL scripting, Piano roll, Windows UI and export helpers. They can compose, edit, arrange, mix and render within actual installed capabilities. A simple visual/VB.NET UI is optional, not the automation foundation.
2. **Procedural generator:** uses those FL-exported sounds and authored musical rules to create developing, coherent variations. Playback does not require FL Studio or an agent to remain open.
3. **DJ:** receives requests for state, genre or next song, chooses eligible recorded/procedural material and schedules a smooth, musically sensible transition.

A **tiny standalone app** exposes requests to the DJ. The current demo provides Play/Pause, Volume/Mute, State, Genre, Next Song, Hold, a cancellable manual queue and a choice between the fixed four-second A→B crossfade and the S05 procedural bridge. Adjustable transition length belongs to the later app scope. The DJ decides the next audible change.

**MVP demonstration:** Codex or Claude uses MCP to make a real editable FL sound/loop → procedural generator plays variations → DJ transitions from recorded A through procedural music into different recorded B under test-app control. **Only after that works and has been heard** should Mission Control send requests to the same DJ interface.

## Read next

- [First playable / MVP acceptance](docs/FIRST_PLAYABLE.md)
- [Current Tasks](docs/CURRENT_TASKS.md)
- [EMF campaign](docs/campaigns/EMF_INITIAL_INFRASTRUCTURE.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Executable S01 foundation](docs/S01_FOUNDATION.md)
- [S03 deterministic DJ and controls](docs/S03_DJ.md)
- [S04 procedural sampler and audition](docs/S04_PROCEDURAL.md)
- [S05 recording → procedural → recording handoff](docs/S05_HYBRID.md)
- [S02 Web Audio player](docs/S02_PLAYER.md)
- [S08 FL Studio authoring MCP](docs/S08_FL_AUTHORING.md)
- [Unified FL Studio MCP + operating guide](docs/FL_AGENT_CONTROL.md)
- [FL Studio control research](docs/FL_STUDIO_INTEGRATION.md)
- [Production guidebook](docs/guides/README.md)
- [Documentation index](docs/README.md)

Broader genres, arbitrary tempo/key mixing, neural vocals, advanced DAW automation, three-day variety and future products remain possible **after this basic system earns them**. The older [40-question review](docs/reviews/MISSION_CONTROL_FIRST_REVIEW.md) is historical; its earlier Mission-Control-first sequence is superseded.

No proprietary FL content, unauthorized samples, model weights or credentials are shipped.
