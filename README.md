# EUTONOS Music

A state-driven music player and procedural performer, with a DJ that keeps the music moving.

**Project status: planning and research.** This repository currently contains the product definition, architecture proposal, production guides, illustrative data contracts, and an initial infrastructure campaign. It does not yet contain a working player, generator, FL Studio MCP server, model integration, or distributable music library.

## The experience

Start with a musical mood. Let a session remain there, develop, intensify, or relax. The music can come from finished tracks, coordinated stems, procedural performances, or combinations of them. A musical director chooses what comes next and how to get there, preserving phrasing and continuity while making room for genuinely different music over time.

The long-term target is a library and set of generators that can remain interesting across a three-day listening horizon. This is a variety and curation target, not a claim that a few random loops provide 72 hours of distinct music.

External applications can request a state. The engine owns when and how that request becomes audible. Mission Control is one possible consumer; the music system should also work on its own.

## Proposed approach

- **FL Studio is the production workshop.** Compose music, design sounds, prepare stems and instruments, and audition AI-assisted changes.
- **A local engine owns playback.** The default architecture runs on the listener's computer, with a browser control interface. A browser-only renderer remains a comparison and portability option.
- **The DJ chooses and transitions.** It uses musical compatibility, recent listening history, state constraints, and known entry/exit points.
- **Recipes perform new variations.** Each recipe has its own sounds, musical vocabulary, motifs, arrangement rules, and supported states.
- **AI works ahead of playback.** Codex, Claude, or explicitly configured local models can help author music and prepare assets. Model latency is kept outside the audio deadline.
- **Vocals are produced deliberately.** Score-driven singing, full-song generation, voice conversion, and recorded performances are different production routes with different controls and permissions.

## Start here

| Read | Purpose |
| --- | --- |
| [Product goal](docs/PRODUCT_GOAL.md) | Intended experience, boundaries, and measurable outcomes |
| [Features](docs/FEATURES.md) and [capabilities](docs/CAPABILITIES.md) | Proposed components and what a person can accomplish with them |
| [Architecture](docs/ARCHITECTURE.md) | Responsibilities, runtime choices, and audio/control separation |
| [Library and transitions](docs/LIBRARY_AND_TRANSITIONS.md) | Asset assessment, transition graph, hybrid handoffs, and long-term variety |
| [Test app](docs/TEST_APP.md) | State selector, musically meaningful sliders, and listening experiments |
| [FL Studio integration](docs/FL_STUDIO_INTEGRATION.md) | Official APIs, community MCP candidates, and the proposed bridge |
| [Vocals and models](docs/VOCALS_AND_MODELS.md) | Local singing/model options and their practical limits |
| [Music and production guides](docs/guides/README.md) | Theory, genre recipes, arrangement, sound design, FL workflow, and agent collaboration |
| [Current tasks](docs/CURRENT_TASKS.md) | Current campaign and exact next pickup |
| [Initial infrastructure campaign](docs/campaigns/EMF_INITIAL_INFRASTRUCTURE.md) | Stages, dependencies, review gates, and acceptance |

The complete navigation map is [docs/README.md](docs/README.md). Read [AGENTS.md](AGENTS.md) before changing the repository.

## First useful result

A local listening app that plays a small, rights-cleared fixture library, performs several distinct musical recipes, accepts an external state request, and demonstrates recorded-to-procedural-to-recorded transitions. Its interface must show both the requested state and the actual audible state.

The first infrastructure release proves the mechanism. Building a broad, professionally curated library and qualifying three-day musical variety are later outcomes with their own evidence.

## Status and rights

All runtime features are proposed until their campaign acceptance evidence says otherwise. Example JSON is documentation, not an implemented API. No proprietary FL Studio content, third-party voice banks, model weights, credentials, or audio packs are bundled here. Public availability of this repository does not select an open-source license; the project license remains an explicit owner decision before code or reusable content distribution.

Planning baseline: **2026-11-03**, America/Chicago.
