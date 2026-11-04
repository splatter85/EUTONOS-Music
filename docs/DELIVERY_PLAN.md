# Delivery plan

Document ID: `EM-D009`  
Status: proposed sequence, 2026-11-03.

## Current authorization and finish line

The current request authorizes a public repository documentation baseline: product goals, preliminary features/capabilities/architecture, detailed music/FL/voice guides, Current Tasks, and an initial infrastructure campaign. It does not ask this turn to install tools, operate a DAW, download model weights, build the runtime, publish music, or purchase services.

The documentation baseline is delivered separately from implementation. [Current Tasks](CURRENT_TASKS.md) identifies the next pickup; the [campaign owner](campaigns/EMF_INITIAL_INFRASTRUCTURE.md) owns its status, stage map and acceptance.

## Phase A — initial infrastructure

Build a thin, audible vertical path with a small, reviewed fixture corpus. The key result is a controllable local system that can play recordings, perform several recipes, transition between them, remember recent selections and accept state from another client. Include a bounded working FL authoring bridge and a documented optional production-job interface.

The first model/voice exercise should qualify one selected route or explicitly leave it unsupported with a clear next action. Do not make an optional singing model a hidden prerequisite for instrumental playback.

## Phase B — musical breadth

Develop more original recorded material, compatible section sets, instrument palettes and recipe families. Add variation through different musical vocabulary, groove, sound and form. Expand the transition graph with reviewed bridges. Evaluate catalogue coverage and long-session musical experience.

The three-day variety target belongs here. It requires enough eligible content and listening evidence to justify the claim. The initial infrastructure's endurance tests can be reused only for the unchanged technical scope they actually tested.

## Phase C — deeper production assistance

Expand supported FL operations, reusable authoring templates, reference/audition workflows, and provider-specific singing/model adapters. Improve how plain-language feedback becomes precise revisions. Add another DAW only after the production abstraction and a real need are clear.

Avoid creating a general-purpose agent platform inside the music system. Existing Codex/Claude sessions remain useful clients; local models are optional producers with bounded jobs and artifacts.

## Phase D — application integrations and packaging

Integrate external consumers such as Mission Control through the state API. Package a supported local installation and optional browser renderer where it has passed qualification. Keep remote-control/audio-streaming features explicit; a browser UI controlling a local machine is not automatically a cloud music service.

Choose the public project/code/content license and distribution strategy before shipping third-party dependencies or packs. Original compositions, reusable assets, model weights and voice libraries may need separate release policies.

## Smallest first musical experiment

Create or obtain eligible reference material for three different musical families. Compare a curated-stem approach, a procedural performance and a hybrid handoff using matched sound quality where possible. Listen before committing to a large implementation stack. Record what the engine needs to preserve: groove, motif, phrasing, sound palette and state response.

The first technical spike should answer a small number of concrete questions: which backend can schedule/mix reliably, what stays outside the audio callback, how the browser reconnects, and whether a compact compiled worker is justified. Select one production path after the evidence.

## Dependencies and explicit decisions

| Decision | Due before | Evidence |
| --- | --- | --- |
| Initial musical families and fixture rights | Import/public fixture distribution | Audition references, source/permission records, creator intent |
| Native/browser backend and language packaging | Broad runtime implementation | Bounded audio/lifecycle/resource spike |
| Exact FL supported operation set | DAW automation implementation | Installed-version probes and reversible project test |
| Stretching/time-pitch library | Transitions that need it | Listening, latency, phase and dependency-license review |
| Local singing/model route | Model installation and pack generation | Hardware envelope, control needs and exact dependency eligibility |
| Public project/content licenses | Code/asset release | Owner choice informed by the selected dependency and asset terms |
| Default state/novelty settings | Initial owner acceptance | Real listening comparisons |

These decisions should be made when needed, using existing authorization and concrete evidence. Do not turn ordinary implementation choices into a permanent approval chain.
