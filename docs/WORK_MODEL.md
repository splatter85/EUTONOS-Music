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

The current documentation request finishes with the planning baseline. Future implementation, installation, model execution and production actions follow the selected stage and the user's actual authorization. Do not infer that a future feature list admits all of them now.

## Reviews

The initial campaign includes adequacy review before implementation, scaffold correctness/efficiency review before broad dependent layers, and final assembled review before qualification/owner acceptance. Reviews produce bounded KEEP/CHANGE/DEFER findings, distinguishing reproduced defects, inspection risks and speculative improvements.

Correct material findings and re-review the affected scope. Keep unaffected evidence. Do not create broad cleanup work from a KEEP result or transform every review suggestion into a blocker.

## Checkpoint and recovery

A useful checkpoint states what actually exists, exact evidence/source versions where relevant, remaining limits, and the immediate next action. Update it after meaningful progress or a changed direction. A checkpoint is the last recorded observation; inspect the current repository/environment before replaying anything after an interruption.

For external operations, record the caller-known command ID and outcome. A timeout can leave an unknown effect. Read back the project/artifact/server state before retrying a potentially duplicated operation.

Historical experiences stay historical when source changes. The source version observed then, the event itself, and applicability to current code are separate questions.

## Closeout

Report practical outcome, checks and limits, position in the current campaign map, overall effort with a basis or unknown, plan unchanged/updated/review due, instruction updates where relevant, and the next stage's purpose/prerequisites. Report only verified delivery states.

The project may later adopt native RAM/boards through supported EUTONOS tooling. Until then, concise source-linked progress records provide continuity without pretending that a native capture occurred.
