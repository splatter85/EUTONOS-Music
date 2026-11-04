# EUTONOS Music

**First make a simple standalone music system work. Then connect Mission Control.**

**Status:** MVP defined, but no working controller/player/generator or auditioned music in this repo yet.

## Three layers

1. **Visual Basic AI controller:** a small Windows VB.NET UI (provisional interpretation of “Visual Basic”) uses a supported Codex/Claude workflow to make editable material in FL Studio and export a verified loop or sound. One useful operation is enough for MVP.
2. **Procedural generator:** uses those FL-exported sounds and authored musical rules to create developing, coherent variations. Playback does not require FL Studio or an agent to remain open.
3. **DJ:** receives requests for state, genre or next song, chooses eligible recorded/procedural material and schedules a smooth, musically sensible transition.

A **tiny standalone app** provides Play/Pause, Volume/Mute, State, Genre, Next Song, Hold and Transition length. The DJ—not the app—decides the next audible change.

**MVP demonstration:** controller makes a real sound → procedural generator plays variations → DJ transitions from recorded A through procedural music into different recorded B under test-app control. **Only after that works and has been heard** should Mission Control send requests to the same DJ interface.

## Read next

- [First playable / MVP acceptance](docs/FIRST_PLAYABLE.md)
- [Current Tasks](docs/CURRENT_TASKS.md)
- [EMF campaign](docs/campaigns/EMF_INITIAL_INFRASTRUCTURE.md)
- [Architecture](docs/ARCHITECTURE.md)
- [FL Studio control research](docs/FL_STUDIO_INTEGRATION.md)
- [Production guidebook](docs/guides/README.md)
- [Documentation index](docs/README.md)

Broader genres, arbitrary tempo/key mixing, neural vocals, full DAW automation, three-day variety and future products remain possible **after this basic system earns them**. The older [40-question review](docs/reviews/MISSION_CONTROL_FIRST_REVIEW.md) is historical; its earlier Mission-Control-first sequence is superseded.

No proprietary FL content, unauthorized samples, model weights or credentials are shipped.
