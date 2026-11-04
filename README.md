# EUTONOS Music

**The music player/generator for EUTONOS Mission Control: authored music, procedural performance and a DJ that makes them flow.**

Start by making that experience genuinely enjoyable. A broader standalone product is possible if real use earns it; building a general music platform is not a prerequisite.

**Status: design and research only.** No player, generator, test app, FL Studio MCP server, model adapter or distributable music library is implemented here yet.

## The first experience

Enable Music in Mission Control, press Play, choose a vibe, and let the soundtrack develop. It can hold a mood while changing musical identity, or preserve an identity while becoming more driving. Manual hold, pause and mute always outrank automatic state changes. The engine plans when a requested change becomes audible instead of treating a state request as a hard cut.

The intended system combines finished recordings, synchronized stems, authored procedural recipes and deliberate bridges. FL Studio supplies production quality and editable source material. Ordinary playback should not require FL Studio, an AI subscription, a GPU or a running model.

The first audible experiment uses two recordings and one procedural identity in a recorded → procedural → different-recording journey. The usable Mission Control pilot adds several families, selection/history, real integration and listening evidence. The full FL authoring bridge, production jobs and later vocal/model routes remain planned; they do not block the first useful soundtrack.

## Start here

| Document | Purpose |
| --- | --- |
| [First playable](docs/FIRST_PLAYABLE.md) | Concrete audible-proof and usable-pilot boundaries |
| [40-question review](docs/reviews/MISSION_CONTROL_FIRST_REVIEW.md) | Answers, design consequences, unresolved experiments and ten strengths |
| [Product goal](docs/PRODUCT_GOAL.md) | Mission Control-first scope and preserved long-term requirements |
| [Architecture](docs/ARCHITECTURE.md) | Shared musical timing, playback/production separation and renderer decision |
| [Library and transitions](docs/LIBRARY_AND_TRANSITIONS.md) | Recorded/procedural continuity, compatibility, curation and variety |
| [Music and production guides](docs/guides/README.md) | Detailed theory, genre, FL Studio, recipe, agent and vocal guidance |
| [Current Tasks](docs/CURRENT_TASKS.md) | Immediate pickup and scope |
| [EMF campaign](docs/campaigns/EMF_INITIAL_INFRASTRUCTURE.md) | Stable implementation stages grouped into useful milestones |

The [documentation map](docs/README.md) includes the feature/capability catalogues, test app, state API, FL integration, model research and validation. Read [AGENTS.md](AGENTS.md) before making changes.

## What stays ambitious

Multiple musical recipes per mood; production-quality sound; smooth recorded/generated handoffs; a growing library; useful agent-assisted composition; and ultimately an interesting three-day listening horizon. Runtime endurance, catalogue coverage and enjoyable musical breadth are different claims and will be tested separately. A large seed count is not proof of interesting music.

## Implementation direction

Use one playback owner and one audio clock, with a small browser interface and neutral state commands. Investigate Web Audio first for the audible proof; select one pilot backend from measured scheduling, lifecycle and resource behavior. Native local playback remains available if the required experience justifies it. Do not implement two production backends before one earns its place.

## Rights and evidence

No proprietary FL sounds, private projects, voice banks, model weights or credentials are bundled. A purchased production tool does not automatically grant permission to redistribute its sound content as a reusable pack. Public availability of this repository does not select an open-source license; project and content licensing remain explicit owner decisions before distribution.

All examples are design illustrations, not working APIs. See [Progress](docs/PROGRESS.md) for versioned evidence and limits.

Updated: 2026-11-03, America/Chicago.
