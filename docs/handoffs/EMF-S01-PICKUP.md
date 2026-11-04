# EMF-S01 — first agent-instance pickup

**Kind:** PICKUP BRIEF — **NOT A COMPLETED SLICE HANDOFF**  
**Campaign:** `campaign-emf-001` (EMF — Initial infrastructure)  
**Slice:** `EMF-S01` — portable source/pack/request contracts and original fixtures  
**Status when prepared:** PLANNED; no S01 implementation, test or audio generated  
**Location:** **CLOUD — ChatGPT coding environment with GitHub repo `splatter85/EUTONOS-Music`**  
**Preparation date:** 2026-11-04  
**Planning source:** `63457d9ff9be52360d4a3ea69e3a06d1ec5dd427`; **check current main** before touching code. This historical SHA is not a live branch lock.

## Mission

Create the **small, tested foundation** that lets S02 build the browser player, S03 the DJ/queue, S04 the procedural source, and S08 independently produce real FL Studio music on PC. Do not build the entire platform now. The contract must accept original cloud fixtures and later FL-exported material **without changing the DJ's interface**.

The current repo is planning-only. The existing files under `docs/examples/` are fictional, unimplemented demonstrations with missing audio and unverified permissions. **They are not a real fixture pack or an executable schema.**

## Read before implementation

- [AGENTS](../../AGENTS.md), [Current Tasks](../CURRENT_TASKS.md), [Work Model and handoff policy](../WORK_MODEL.md), [Campaign / EMF-S01](../campaigns/EMF_INITIAL_INFRASTRUCTURE.md).
- [First playable](../FIRST_PLAYABLE.md), [Architecture](../ARCHITECTURE.md), [DJ state/requests](../STATE_AND_CONTROL_API.md), [Library and transitions](../LIBRARY_AND_TRANSITIONS.md), [Example inventory](../examples/README.md), [Validation](../VALIDATION.md).
- [FL MCP design](../FL_AGENT_CONTROL.md) **only to define the producer/import seam**, not to run PC automation here.

## Required S01 deliverables

1. **Versioned portable pack format and validation** for actual audio paths/bytes/hashes, stable IDs, source kind, tempo/meter, bar/phrase/cue units, eligibility/rights, genre/state metadata where known, and basic recipe/palette references. Choose a *minimal executable v0* rather than making all fields in the large example JSON mandatory; document omissions and keep unknowns unknown.
2. **Common playable-source lifecycle** for recordings and procedural performances: prepare, schedule start, expose valid exits, stop/transition out, release. One audio clock; no duplicate clock owned by the source. In S01 it can be an interface and test double, not a full renderer.
3. **Typed request/queue contract** for setState, requestGenre, queueTrack, nextSong, Hold and transport. Preserve request ID/replay, manual queue precedence, clear errors for missing media/genre, and separation of requested/planned/audible state. No real DJ planner required yet.
4. **Original, eligible fixture audio:** two distinct but harmonically/temporally compatible recordings A/B and small drum/percussion/bass/harmony or texture sample inputs. Synthetic original audio is fine for a timing/contract test; do not claim professional sound. Record provenance and actual file hashes; fixtures should be decodable and reproducible, not pointers to missing files.
5. **Automated tests and run instructions:** validate good and bad manifests, duplicate IDs, path/hash mismatch, incompatible or invalid cues, sample rate/frame/length checks and deterministic regeneration where applicable. Run real tests and capture exact commands/results. Name any check still unrun.

Use a restrained TypeScript project structure if useful for S02's browser/Web Audio direction. Do not add an unnecessary native server, database, neural model, GUI automation package or paid service. The contract, fixture generator, tests and short setup guide should be enough for a fresh coding agent to continue.

## Scope and non-goals

**In scope:** data/types, validators, test doubles, original audio fixtures, a small repeatable build/test workflow, the necessary README or docs and meaningful review of this code.

**Not in scope:** actual FL Studio/Windows operations, MCP installation, recording/performer audio engine, full DJ algorithm, Mission Control connector, AI singing, three-day variety, arbitrary file key/BPM analysis or unlicensed samples. Don't mark the full MVP complete.

## Exit check and publication

S01 completes only when the schema/API are **executable and tested**, fixture files actually exist or can be reproducibly built and verified, docs state their rights/provenance, and the repo's code/tests/build pass in the actual environment. Record specific test output and any limitation, not a generic “looks right.” Run a short focused adequacy review (KEEP/CHANGE/DEFER) on the chosen boundary, one clock and fixture legality; do not restart research needlessly.

Update the **campaign**'s authoritative EMF-S01 checkpoint/status and the **Current Tasks** pointer. Publish scoped implementation and a detailed **`docs/handoffs/EMF-S01-HANDOFF.md`** using the [template](SLICE_HANDOFF_TEMPLATE.md). Read back the published commit and file. **Give the owner a short mini handoff in the final chat**, with the checked SHA, outcome, tests/limits, one next slice and PC opportunity.

## Next instance after S01

**Primary:** **EMF-S02 — CLOUD**, build the browser player with two recorded sources and a cue-checked A→B transition from the published pack/source contract.

**Optional parallel PC lane:** once S01 is published and read back, tell the owner they **can pull that revision to start EMF-S08 on PC** (real Codex/Claude → one MCP broker → FL Studio editable notes and WAV export), while the cloud worker proceeds independently through S02–S07. Don't claim installation or compatibility before actual PC inspection.

**Receiver instruction:** verify current main, implement **only S01**, leave a detailed repo handoff + mini chat handoff on stop; do not automatically begin S02 or S08.
