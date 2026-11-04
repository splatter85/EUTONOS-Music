# Research map and evidence boundaries

Document ID: `EM-D013`  
Source review: 2026-11-03, America/Chicago.

This map records useful precedents and primary documentation behind the proposed design. It is a route into the evidence, not a list of dependencies already selected or installed. A published demonstration can establish that a technique exists; it cannot establish how an unbuilt EUTONOS-Music implementation will sound.

## Musical precedents

| Source | What it contributes | Boundary for this project |
| --- | --- | --- |
| [Switch Angel — Coding Trance](https://jaderose.bandcamp.com/album/coding-trance) | An artist's released music made through a code-based creative practice; a relevant listening reference for electronic production beyond simple demo tones. | Human composition and live coding are not proof of unattended adaptive composition. The release is a listening reference, not an asset pack to copy. |
| [Endless Acid Banger](https://www.vitling.xyz/toys/acid-banger/) and [its source](https://github.com/vitling/acid-banger) | A public generative acid-music instrument showing how a focused sound vocabulary, rhythm and variation rules can sustain a recognizable style. | A narrow musical world does not meet the requested multi-genre library or three-day breadth goal by itself. Check its source license before reuse. |
| [Wreckage Systems FAQ](https://www.65daysofstatic.com/wreckage-systems-faq/) and [V1 archive/V2 description](https://65labs.itch.io/wreckage-systems-v1-archive) | Artist-authored, sample-based generative systems with distinct identities. This is a useful precedent for a collection of musical systems rather than a single universal randomizer. | These are the creators' descriptions, not an independent quality evaluation or permission to redistribute their sounds. |
| [Strudel project integration](https://strudel.cc/technical-manual/project-start/), [random modifiers](https://strudel.cc/learn/random-modifiers/) and [tonal functions](https://strudel.cc/learn/tonal/) | Expressive pattern construction, musical transformations and a browser-oriented environment to study or prototype. | Integration needs an explicit decision about its AGPL terms and deployment boundaries. A pattern language still needs a composed palette and musical rules. |
| [Tidal tutorial](https://tidalcycles.org/docs/getting-started/tutorial/) and [randomness reference](https://tidalcycles.org/docs/reference/randomness/) | Useful references for deterministic patterns and controlled random choices. | Reproducible event choices do not guarantee byte-identical output from arbitrary instruments or plugins. |
| [Cadenza](https://github.com/Andrea-Cavallo/cadenza) | A compositional/MIDI project to assess for structured generation and editable outputs. | Upstream beta scope and its actual supported workflows must be evaluated. It is not a selected real-time backend. |
| [Generative Electronica Research Project](https://www.metacreation.net/projects/generative-electronica-research-project) | Research precedent for studying generative electronic music as composition and evaluation. | Research goals and demonstrations do not establish a production-ready dependency or musical acceptance here. |

**Design inference:** these precedents support exploring authored musical systems with bounded variation. They do not support the claim that unconstrained randomness, a large seed count, or a language model alone will produce an enjoyable long session. The proposed architecture therefore gives sound design, arrangement, curation and listening review explicit owners.

## Audio and control infrastructure

| Source | Relevant documented capability | Decision still needed |
| --- | --- | --- |
| [miniaudio overview](https://miniaud.io/) and [manual](https://miniaud.io/docs/manual/index.html) | Native audio device, decoding and playback building blocks. | Measure the selected implementation's transport, scheduling, resource use and packaging on the reference machine. A library's feature list is not our latency result. |
| [MDN AudioWorklet](https://developer.mozilla.org/en-US/docs/Web/API/AudioWorklet) | A browser audio processing surface separate from ordinary main-thread UI work. | Compare a bounded browser renderer with the native reference architecture; do not infer persistence or background behavior without testing. |
| [Rubber Band source](https://github.com/breakfastquay/rubberband) and [API documentation](https://www.breakfastquay.com/rubberband/code-doc/index.html) | Time-stretch/pitch-shift processing and integration details such as latency and padding. | Choose acceptable quality/resource settings and resolve GPL/commercial licensing for the eventual distribution. Keep an abstraction so another implementation can be compared. |
| [MCP specification](https://modelcontextprotocol.io/specification) and [Streamable HTTP source](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/specification/2026-07-28/basic/transports/streamable-http.mdx) | Tool interaction and transport requirements, including local-service protections. | Pin the protocol/SDK versions used in implementation and qualify actual client behavior. MCP does not provide musical scheduling or DAW transaction semantics. |

The [architecture](ARCHITECTURE.md) owns proposed component boundaries. The [control contract](STATE_AND_CONTROL_API.md) owns command, state and replay behavior. No dependency is installed by this research record.

## FL Studio and production evidence

[FL Studio integration](FL_STUDIO_INTEGRATION.md) contains the detailed source table, official API distinctions, and commit-pinned reviews of four community MCP candidates. It separates controller scripting, Piano roll scripts, MIDI exchange, GUI interaction and rendered-file handoff. Those surfaces have different capabilities and completion evidence.

[FL Studio workflow](guides/FL_STUDIO_WORKFLOW.md) links the official manual for rendering, MIDI, instrument sampling and routing. It also records the distinction between producing a finished musical work and distributing reusable samples, stems or instruments. Exact edition, installed build, plugin inventory and relevant asset permissions remain workstation facts to discover during implementation.

No community adapter was installed or exercised against FL Studio for this baseline. A repository containing a function is source evidence; a successful note edit or render requires observed host behavior.

## Singing and generative models

[Vocals and models](VOCALS_AND_MODELS.md) owns the current comparison and primary-source links for ACE-Step, YuE2 and legacy YuE, DiffSinger/OpenUtau, RVC, Synthesizer V, Demucs and an optional hosted music route. It separates code, model-weight, voice-bank and output-use terms, with version-specific qualifications.

This separation matters because a new model generation or a different voice can change capabilities, hardware requirements and terms. For example, the current YuE repository's YuE2 documentation and weight terms must not be replaced with assumptions from the older YuE-v1 model cards. Use the linked version evidence rather than a remembered project name.

The model table is a candidate assessment. It contains no measured generation speed, local installation result, vocal-quality rating or guarantee of repair cost for the owner's machine. The [vocal production guide](guides/VOCAL_PRODUCTION.md) defines the listening work needed to accept actual material.

## How to maintain this research

For a dependency or model selected during implementation, record the exact version/commit/checkpoint, relevant documentation, license evidence, supported environment, intended use and tested capability. Keep upstream claims distinct from local observations. Replace a moving-link assumption with a versioned evidence record before relying on it for release.

For musical sources, use lawful reference listening and record what is being learned: phrasing, groove, palette, arrangement or transition behavior. A genre label is not a recipe, and a reference recording is not automatically a distributable input.

Source review for this baseline was textual and documentary. It did not include listening to generated audio, running the cited engines, benchmarking a device, validating licenses for a particular future distribution, or verifying every external page's future availability.
