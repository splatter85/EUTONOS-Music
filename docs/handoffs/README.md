# Slice handoffs

This folder contains versioned context for the **one EMF campaign**. [Work Model](../WORK_MODEL.md) owns the policy; [EMF campaign](../campaigns/EMF_INITIAL_INFRASTRUCTURE.md) alone owns live status and the slice order.

## Mandatory at every slice stop

When a slice is **COMPLETE**, **PAUSED**, or **BLOCKED**, the worker must:

1. Publish a **detailed** `docs/handoffs/EMF-Sxx-HANDOFF.md` using the [template](SLICE_HANDOFF_TEMPLATE.md). Include actual outcomes, changed source, checks, failures, limitations, last verified checkpoint, and one next action with environment.
2. Update the authoritative campaign checkpoint/status and [Current Tasks](../CURRENT_TASKS.md) pointer, without starting the next slice automatically.
3. Verify that GitHub actually contains the handoff and scoped changes at an exact commit/ref. A queued or local write is not publication; if publication fails, report it.
4. In the **same final chat response**, give the owner a **short copy/paste mini handoff** referencing the detailed file and checked commit, outcome, crucial evidence/limits, next slice/environment and first action. This is not an asynchronous reminder.

A handoff is an **as-of snapshot**, not a second task/status owner; the receiving instance inspects current main and reconciles later changes. Do not invent test results, audio auditions, owner approvals or FL integration. Never include credentials, private files or nonredistributable music in this public repository.

A **PICKUP** brief is a starting assignment, **not** a closeout. The initial [S01 pickup](EMF-S01-PICKUP.md) remains historical assignment context. The [S01 handoff](EMF-S01-HANDOFF.md) now records the actual implementation, evidence and next pickup; inspect its disposition and the campaign before proceeding.

The [S02 handoff](EMF-S02-HANDOFF.md) records the small browser player's source, verification and next pickup. Its browser/rendering evidence is separate from physical output and listening acceptance.

The [S08 handoff](EMF-S08-HANDOFF.md) records the PC FL Studio authoring facade, its live Claude Code/Codex evidence and limits. Its renders are owner-local and unauditioned.

**Special PC notices:** at S01 completion, tell the owner the checked pack revision allows **S08 PC** to begin in parallel with cloud S02–S07. At S07 completion, supply the tested cloud build revision/run commands for **S09 PC** after S08 real FL outputs exist. Both notices happen during their respective slice closeouts.

Keep one handoff per slice, updating it with clear provenance on resumption; Git preserves prior versions. Avoid copying the whole campaign or a private chain of thought.
