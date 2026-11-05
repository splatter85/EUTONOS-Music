# Repository Journeys

Status: SEEDED
Source revision: unresolved

Record user, data, item, and operational lifecycles with entry, transitions,
state, persistence, failure paths, and terminal conditions.

## Journeys

<!-- Add JRN-* records using SCHEMA.md. -->
### `JRN-author-sketch-to-pack` Author a sketch, render it and build a pack
- Kind: journey
- Aliases: FL sketch to audio pack; authoring workflow
- Summary: Entry: an agent client launches the stdio server. Ordered steps: fl_capabilities and fl_inspect read host and project state; fl_create_project makes a disposable project from the single allowlisted template; fl_prepare_edit dry-runs notes or tempo against the exact revision; fl_acquire_writer takes the lease; fl_apply_edit writes with a journal, backup and file readback; fl_verify has FL export MIDI and compares it (FL must be closed); fl_save writes a checkpoint; fl_render renders WAV through the FL CLI; fl_verify_export re-checks it; fl_build_pack validates and writes an em.audio-pack.v0 pack. Decision points: TARGET_CHANGED means re-inspect and prepare again; TARGET_MISMATCH means a pattern or channel index and expected name no longer agree; HOST_BUSY means close FL; OUTCOME_UNKNOWN means call fl_operation_status before retrying; fl_restore recovers an earlier backup. Terminal outcome: a pack in the workspace packs folder with unreviewed eligibility. Stops there: loading that pack into the player is not wired by these sources.
- Evidence: `src/authoring/mcp-main.ts`; `src/authoring/mcp-server.ts`; `src/authoring/broker.ts`
- Related: `SURF-mcp-stdio-server`; `INT-fl-create-project`; `INT-fl-prepare-edit`; `INT-fl-acquire-writer`; `INT-fl-apply-edit`; `INT-fl-verify`; `INT-fl-save`; `INT-fl-render`; `INT-fl-build-pack`; `INT-fl-restore`; `INT-fl-operation-status`; `AREA-fl-authoring-capability`
- Review: candidate
- Revision: 431ecb2e38117c4fc16eb73d6bccf5af54d2bfc0a598686aeb986632649921db

### `JRN-load-pack-play-ab-transition` Load a pack and play an A/B transition
- Kind: journey
- Aliases: demo playback; schedule A to B
- Summary: Entry: the demo server serves the page, which loads a pack by manifest URL (the page script is in web/, not cited). loadBrowserPack fetches, validates and size-limits the manifest and media; SmallPlayer is built on a checked A to B route; play(a|b) resumes the AudioContext from the user gesture, decodes once and schedules the source at its entry cue; scheduleAB (allowed after Play A) plans the exit cue against the shared clock, schedules B with a fade-in and sets A to transition out. A transition operation counter now also lets a future handoff be cancelled before its cue. Pause, resume, stop, volume and mute are immediate. Failures such as ineligible audio, a passed exit cue or a closed context surface as errors. Physical output is not tested.
- Evidence: `src/browser-pack.ts`; `src/player.ts`; `src/web-audio.ts`; `scripts/serve.ts`
- Related: `SURF-demo-http-server`; `AREA-pack-ab-playback-demo`; `SYS-web-audio-transition-player`; `SYS-pack-validation`; `SYS-demo-server`
- Review: candidate
- Revision: e8b9a0ae28ef816f8cdf65792867c0dc64f50d1472d918fbbb26f03205a6454c

### `JRN-control-request-lifecycle` Control request acceptance lifecycle
- Kind: journey
- Aliases: DJ request flow; command receipts
- Summary: A caller (now DeterministicDj) builds a ControlContract from a catalog, an engine generation and an initial state, then accept(request) canonicalizes: a repeat commandId returns the stored receipt, a different body rejects with id-conflict; otherwise checks run (valid request, expected revision, manual-only types including cancelQueue and cancelNext, hold, queue entry and catalog availability) and on acceptance intent or the FIFO queue changes, the revision increments and a receipt reports execution pending. The caller acknowledges the queue head, reports a prepared plan and the renderer reports audible state; a new engine generation clears prepared and audible evidence but not retry identities.
- Evidence: `src/control.ts`; `src/index.ts`
- Related: `SYS-control-request-contract`; `GAP-control-contract-unwired`; `SURF-library-exports`
- Review: candidate
- Revision: e8b9a0ae28ef816f8cdf65792867c0dc64f50d1472d918fbbb26f03205a6454c

### `JRN-project-revision-lifecycle` FL project revision lifecycle and recovery
- Kind: journey
- Aliases: project history; backups; journal replay
- Summary: Data lifecycle of one workspace project, owned by the broker. Create: exclusive mkdir, template copy, journal start, then the .flp and project.json are written (project.json last, and a project only counts as existing once project.json is present), then journal completion. Identity is the SHA-256 of the .flp bytes. Prepare: writes a prepared change file keyed by a hash of the request, no project mutation. Apply: under lease and per-project lock, rechecks before-revision, replans deterministically, journals start, backs up the before-revision by hash, atomically writes (temp file plus retrying rename), reads back, journals completion. Save writes a hash-checked checkpoint; render writes a render folder with render.json; build_pack builds in a scratch folder and renames it into place. Restore keeps the replaced revision as a backup before swapping in a hash-checked backup. Recovery boundaries: a repeated operation_id with the same payload replays the recorded outcome, a different payload conflicts, a started-without-outcome record needs fl_operation_status, a torn final journal line is cut off into journal.torn, damage elsewhere raises JOURNAL_CORRUPT, leases expire and stale locks are broken. fl_operation_status reconciles an interrupted create, apply, restore, save, render or pack from durable state only (revision hash, checkpoint, render record, pack validity); other kinds have no rule and stay unknown. For an unfinished create it moves the incomplete project folder aside as .abandoned-*, and a failed pack build removes its scratch folder. Journal append and file write are not one atomic step, so a crash between them leaves the operation started and needs that reconcile. No deletion of projects or backups was found. Compatibility: writes are allowed only for the verified FL 24.x layout.
- Evidence: `src/authoring/broker.ts`; `src/authoring/flp.ts`; `src/authoring/errors.ts`
- Related: `SYS-authoring-broker`; `SYS-flp-codec`; `INT-fl-apply-edit`; `INT-fl-restore`; `INT-fl-operation-status`; `JRN-author-sketch-to-pack`
- Review: candidate
- Revision: 431ecb2e38117c4fc16eb73d6bccf5af54d2bfc0a598686aeb986632649921db

### `JRN-fixture-pack-regenerate-validate` Regenerate and validate the fixture pack
- Kind: journey
- Aliases: fixtures:generate; fixtures:check; validate
- Summary: Lifecycle of the S01 fixture pack. generate-fixtures builds every file in memory deterministically (fixed seed and generator version) and, without --check, writes them into the output directory (default fixtures/s01 relative to the repo), creating folders as needed. With --check it reads each existing file and fails with a message naming the first file that differs. validate-pack then loads the directory through the Node loader, which reads files with in-root, exact-case path checks and verifies byte length, SHA-256 and WAV metadata against the manifest, printing a JSON PASS report with listening marked NOT TESTED, or exiting 1 with the error. Mutation owner is the generator only; files are overwritten in place with no atomic swap or deletion, and nothing here versions or retires old fixtures.
- Evidence: `scripts/generate-fixtures.ts`; `scripts/validate-pack.ts`; `src/node.ts`; `src/audio.ts`
- Related: `SYS-fixture-pipeline`; `SYS-pack-validation`; `SURF-dev-cli-scripts`
- Review: candidate
- Revision: 431ecb2e38117c4fc16eb73d6bccf5af54d2bfc0a598686aeb986632649921db
### `JRN-dj-request-to-transition` DJ request to scheduled A/B handoff
- Kind: journey
- Aliases: Next song; queue track; DJ flow
- Summary: A caller builds DeterministicDj from a loaded pack and sends requests. accept() canonicalizes and deduplicates; execute() either changes intent (state, genre, Hold) or selects a target: the FIFO head, else a different eligible recording matching intent. While stopped, selection is recorded but no audio starts; Play starts the first track. While A plays, selection calls scheduleAB (default crossfade), which plans the exit cue on the shared clock; the hybrid option takes the bridge path instead (JRN-hybrid-handoff). snapshot() later marks the plan started once the renderer frame reaches it, acknowledges the queue head only then, and reports audible state. Cancel next or removing a scheduled queue entry cancels the future voice only before the cue; a late cue gives a visible no-match and keeps the reservation. Hold refuses automatic targets but allows manual queue and Next. Physical output is not tested.
- Evidence: `src/dj.ts`; `src/control.ts`; `src/player.ts`; `src/web-audio.ts`
- Related: `SYS-deterministic-dj`; `SYS-web-audio-transition-player`; `JRN-control-request-lifecycle`; `INT-dj-request`; `JRN-hybrid-handoff`
- Review: candidate
- Revision: 1da0cff9cc6ca2af793fa89c05f07e646c2e483c2f2169d734448cb31e989188

### `JRN-procedural-audition` Compile and audition a seeded procedural phrase
- Kind: journey
- Aliases: sampler audition; seed replay
- Summary: A caller loads the S01 fixture pack with fixtures allowed, calls compileS01Phrase with a seed and state, then SmallPlayer.playProcedural. The player resumes the context, decodes the four-sample palette once with hash and memory checks, builds a ProceduralSource, schedules all notes at a lead frame on the shared clock and unmutes only after the whole schedule commits. The phrase ends at 32 quarters unless an exit at 16 is used for a handoff; stop, release and a stale generation silence it. The same seed and state replay the same events; other packs are refused.
- Evidence: `src/phrase-plan.ts`; `src/procedural-source.ts`; `src/player.ts`; `src/browser-pack.ts`
- Related: `SYS-procedural-sampler`; `INT-play-procedural`; `SYS-web-audio-transition-player`
- Review: candidate
- Revision: e8b9a0ae28ef816f8cdf65792867c0dc64f50d1472d918fbbb26f03205a6454c
### `JRN-hybrid-handoff` DJ Next song through a procedural bridge
- Kind: journey
- Aliases: hybrid Next; A to bridge to B
- Summary: A caller builds DeterministicDj with options {handoff: 'hybrid'} or calls setHandoff('hybrid'). Selection, the FIFO queue, Hold and retries are unchanged, but the DJ compiles a bridge with seed bridgeSeed(commandId) and state drive when Drive is requested, else explore, and calls SmallPlayer.scheduleHybrid instead of scheduleAB. At A's exit cue the bridge enters with percussion while A fades for a bar; bass and harmony start once A is silent; B enters at the bridge's phrase exit while bridge percussion fades. snapshot() reports B planned and started at its own entry (the bridge exit) and consumes a queued B's head only then; once the bridge enters, Cancel next, Next and queue removal are refused while Stop stays immediate and keeps a queued B. It reports bridge seed and state (null when the requested state has no bridge); a bridge that no longer matches a changed request is rescheduled. Physical output is not tested.
- Evidence: `src/dj.ts`; `src/player.ts`; `src/hybrid-handoff.ts`
- Related: `SYS-deterministic-dj`; `SYS-hybrid-handoff`; `INT-schedule-hybrid`; `JRN-dj-request-to-transition`
- Review: candidate
- Revision: 1da0cff9cc6ca2af793fa89c05f07e646c2e483c2f2169d734448cb31e989188
