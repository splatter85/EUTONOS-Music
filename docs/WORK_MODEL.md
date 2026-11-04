# Repo-local work model

Document ID: `EM-D012`  
Status: readable EUTONOS-style convention for this new project, 2026-11-03.

## One owner for each kind of truth

- [Product goal](PRODUCT_GOAL.md) owns the intended experience and requirements.
- [Features](FEATURES.md) names proposed product components; [Capabilities](CAPABILITIES.md) names outcomes people can achieve with them.
- [Architecture](ARCHITECTURE.md) and its linked contract documents own design relationships.
- [Current Tasks](CURRENT_TASKS.md) owns priority and a short next-pickup pointer.
- Each campaign owns its scope, stages, status, evidence and acceptance.
- [Decisions](DECISIONS.md) records concise design choices and when to reconsider them.
- [Progress](PROGRESS.md) records meaningful delivered checkpoints and validation limits.
- Git owns detailed revision history.

This repository has no native EUTONOS board installation. The Markdown records are readable source owners, not generated projections or claims of native registration. Do not add a second machine-readable work store until there is an actual consumer and migration plan.

## Work units and status

A campaign groups dependent outcomes. A stage is a coherent result with inputs, boundaries and an exit check. A small independent fix can use a concise progress entry without creating another campaign.

Use PLANNED, READY, IN_PROGRESS, BLOCKED, IN_REVIEW and COMPLETE, with CANCELLED/SUPERSEDED where needed. A design stage can be complete as documentation while implementation remains planned. Campaign completion requires its explicit acceptance contract; a stage count or passing test count is not an effort estimate.

Keep IDs stable. EMF is `campaign-emf-001`; its stages EMF00–EMF19 retain their meanings. If scope changes, record the change and preserve prior evidence. The campaign table is the status owner; indexes and queues should link to it rather than duplicate all rows.

## Before substantive work

Confirm the assigned outcome, inspect current source/worktree, identify the applicable stage, and record a concrete next step. Reuse the existing campaign when appropriate. User authorization for the requested work should not be turned into repeated permission questions for ordinary reversible implementation choices.

EMF00 finished with the planning baseline. Subsequent implementation, installation, model execution and production actions follow the selected slice and the user's actual authorization; the selected S01, S02 and S03 assignments authorize their bounded implementation, verification and GitHub publication. Do not infer that a future feature list admits all later actions now.

## Reviews

The initial campaign includes adequacy review before implementation, scaffold correctness/efficiency review before broad dependent layers, and final assembled review before qualification/owner acceptance. Reviews produce bounded KEEP/CHANGE/DEFER findings, distinguishing reproduced defects, inspection risks and speculative improvements.

Correct material findings and re-review the affected scope. Keep unaffected evidence. Do not create broad cleanup work from a KEEP result or transform every review suggestion into a blocker.

## Checkpoint and recovery

A useful checkpoint states what actually exists, exact evidence/source versions where relevant, remaining limits, and the immediate next action. Update it after meaningful progress or a changed direction. A checkpoint is the last recorded observation; inspect the current repository/environment before replaying anything after an interruption.

For external operations, record the caller-known command ID and outcome. A timeout can leave an unknown effect. Read back the project/artifact/server state before retrying a potentially duplicated operation.

Historical experiences stay historical when source changes. The source version observed then, the event itself, and applicability to current code are separate questions.

## Per-slice handoff policy

**Owner instruction, 2026-11-04:** At the end of **every slice** (COMPLETE, PAUSED or BLOCKED), provide **both** (1) a detailed handoff published inside the repo at `docs/handoffs/EMF-Sxx-HANDOFF.md` and (2) a short, copy-ready **mini handoff to the owner in the same chat response**, suitable for the next instance. Neither a commit message nor a chat-only explanation replaces the two deliverables. [Folder rules and template](handoffs/README.md) apply. The initial [EMF-S01-PICKUP](handoffs/EMF-S01-PICKUP.md) is an **unstarted assignment brief**, not a completed-slice handoff.

The detailed handoff must state: campaign/slice/status/environment, inspected branch and exact code/data revisions, assigned scope and actual changes, concrete tests/commands and results, audio-render/real-device/listening evidence or explicit **not tested**, source/asset provenance, decisions, remaining defects/blockers, last verified checkpoint, actual Git publication/readback and target-integration state, and **one** executable next slice with its environment/prerequisites/first action. On pause/block, name the exact recovery route without falsely declaring completion. No secrets, private machine details or nonredistributable audio in this public repo.

The mini handoff should be about **100–200 words**: what was done or stopped; checked Git commit and link to the detailed file; crucial evidence and limitations; next slice/location and first step; and any explicit owner/PC action. For **S01**, tell the owner S08 PC can start in parallel after the published pack contract; for **S07**, give the exact tested cloud revision and PC S09 pull/run requirements. These notices are at closeout, **not asynchronous promises**.

**Completion sequence:** verify outcomes → prepare detailed handoff → update **campaign** (sole authoritative status/checkpoint) and **Current Tasks** (pointer) → commit/publish the scoped changes → read back remote commit and handoff → deliver mini handoff in chat. A publication failure must be disclosed and kept recoverable; do not claim a landed file. The containing commit SHA cannot be self-referenced inside its own handoff file; cite the source revision there and the verified containing SHA in the chat.

Handoffs are **historical as-of snapshots**; the campaign is not duplicated into another status board. A new instance must inspect current source and compare applicability before acting. A completed handoff never authorizes automatic execution of the next slice or PC-side effects.

## Closeout

Report practical outcome, checks and limits, position in the current campaign map, overall effort with a basis or unknown, plan unchanged/updated/review due, instruction updates where relevant, and the next stage's purpose/prerequisites. Report only verified delivery states.

The project may later adopt native RAM/boards through supported EUTONOS tooling. Until then, concise source-linked progress records provide continuity without pretending that a native capture occurred.
