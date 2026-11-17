# EMT — Taste and rating assessment

Campaign ID: `campaign-emt-001` (proposed)  
Short ID: `EMT`  
Document ID: `EM-D034` (provisional; the coordinator confirms the number at merge)  
Owner document: this file  
Status: **PLANNED - DRAFT, not started, not admitted by the owner, not on the board**  
Recorded 2026-11-16, America/Chicago

Progress estimate: **unknown**. No slice has started. This is a draft for the owner to accept, change or fold into EMF. It is not registered in [the native board](../WORK_ITEMS.md), and it dispatches nothing.

## Outcome

The owner's sparse song and transition ratings are assessed honestly, checked against the DJ's own evaluator, and turned into small, reversible improvements, without mistaking a handful of taps for proof.

Concretely: every handover is logged whether rated or not; a rating says what it is about; the report gives counts with honest uncertainty in plain language; the evaluator's blind spots are listed; two plans can be compared on the same song pair; song liking and "songs that mix well" are kept apart from handover quality; and a learner can be enabled only behind safety gates, offline replay, an owner decision and a one-tap off switch.

The design is in [Rating assessment design](../RATING_ASSESSMENT_DESIGN.md). It belongs to the same ecosystem as [EMF](EMF_INITIAL_INFRASTRUCTURE.md) (DJ engine), [EMS](EMS_MUSIC_STUDIO.md) (Music Studio and take ratings) and [EMD](EMD_DJ_APP.md) (human-facing DJ app).

## Order and dependencies

1. EMF-S21 supplies the plan record, `em.transition-feedback.v1`, the durable ratings file and the first report. These are in main.
2. EMF-S17 supplies the phone relay, which stays the only writer of local rating files.
3. EMS-S01 + EMF-S16 supply take ratings; EMF-S18 supplies set mode.
4. The transition engine design (separate document, in progress) is expected to supply background pre-analysis, candidate scores and a consumer for plan replay. EMT-S04 and EMT-S05 wait for the parts they need; EMT-S01 to S03 do not.
5. EMT feeds EMF-S23 and EMF-S24 (see [Reconciliation](#reconciliation-with-emf-not-done-here)).

The owner listens only occasionally, at stable build points. Slices are arranged so that S01 to S03 need no listening, and every later slice states exactly what one listening session must provide.

## Scope and boundaries

- **Local only.** Ratings, hearings, policy files and reports stay in the gitignored `local/` folder. No audio, file paths, song titles, notes or rating lines enter this public repository. Checks use synthetic fixtures.
- **One DJ, one clock, one playback owner.** Logging and assessment run outside the audio deadline. The bench plays through the same owner.
- **No stems.** Stem work stays in EMS-S05.
- **Evaluator sets are versioned, never edited in place.** `mix-evaluation-thresholds@1` and `transition-safety@1` stay frozen; a change is a new version approved by a person.
- **The learner chooses only among candidates that passed every gate.** It is off by default.
- **Ratings are the owner's taste, labelled as such.** They are not a listening qualification and not slice acceptance.
- **The DJ never nags.** Prompt rules in the design are part of the contract.
- Portable code (Windows, macOS, Linux); report which OS actually ran each check.

## Slices — proposed order

"Builder" is the proposed model tier, cheapest suitable first; the owner or coordinator may change it.

| Slice | Where | Dependency | Builder | Owner listening | Checked outcome and acceptance evidence |
| --- | --- | --- | --- | --- | --- |
| **EMT-S01** Assessment contract and schemas | CLOUD | EMF-S21 feedback (in main) | Sonnet or Codex; Opus review of the schema contract | None | Owner answers the design's open questions. Executable schemas and validators for `em.transition-hearing.v1`, `em.transition-feedback.v2`, `em.ab-trial.v1`, `em.song-feedback.v1`; read-time v1 to v2 migration that never rewrites the file. Evidence: unit tests on synthetic fixtures, unknown-field refusal, v1 lines still readable, existing gates pass. |
| **EMT-S02** Hearing log and rating capture | PC | EMT-S01, EMF-S17, EMF-S18 | Codex or Sonnet; Opus review of the relay write surface | Engineering only; a real phone check is reported separately or NOT TESTED | Every completed set handover appends one hearing (candidates, chosen, propensity, evaluator readouts, build, context) whether rated or not. Rate card gains *about*, session listening condition and the rate-later list; one tap still works. Evidence: Node and browser checks, body and file caps, stale-view refusal kept, no change to plan choice (plan ids identical before and after on fixtures). |
| **EMT-S03** Assessment report and phone summary | CLOUD | EMT-S02 (schemas from S01 are enough to start) | Sonnet | None | `em.rating-assessment.v1`: counts with shrunk estimates and 90% intervals, sessions and pairs beside every count, sample-rule tiers, recipe-within-tempo-band tables, survivorship labelling for fallback cuts, no-ratings-needed health lines, alert rules, plain-language sentences; read-only phone summary. Evidence: fixed synthetic datasets with hand-checked expected numbers and sentences; a "too little data" dataset produces no pattern claims. |
| **EMT-S04** Evaluator calibration and blind spots | CLOUD + PC | EMT-S03, EMF-S20 evaluator; clash estimates from S21 Part B or the transition engine where available | Opus design, Sonnet build | Uses whatever local ratings exist; no new session required | Per-metric comparison of disliked against other hearings with the minimum-count rule; evaluator-against-owner table; individual PASS-but-disliked list with tags; tag-to-metric map showing unmeasured complaints. Output is a **proposal** list only. Evidence: synthetic fixtures with planted blind spots are found; below-minimum data shows raw values and no score; no threshold file changes. |
| **EMT-S05** Same-pair A/B bench and consistency check | PC + owner | EMT-S02; a consumer for `replayOverrides` (transition engine or EMF-S23 audition) | Opus | **Yes: one review session** | Two candidate plans for the same exit and entry are rendered, pre-checked and played in hidden random order; answer First, Second or No difference; a few earlier plans are re-presented for self-consistency; optional opt-in audition of rejected candidates (never clipping or true-peak failures) if the owner allows. Evidence: determinism and order-randomisation tests, one playback owner, trials stored as `em.ab-trial.v1`; the owner's session is reported as their answers, not as proof of quality. |
| **EMT-S06** Song reactions and mixability | PC | EMT-S03, EMF-S16, EMF-S18; EMS-S04 optional | Sonnet | Optional | In-set song reaction and a local, reversible "don't play this" list; pair history; attribute-level mixability; next-song suggestions ranked by measured compatibility with a bounded rating adjustment and a one-line reason; halo check (transition ratings split by the incoming song's rating). Evidence: tests that a rating about the song never enters transition scores, that take ratings are never modified, that suggestions keep variety limits, and that queue order stays the owner's. |
| **EMT-S07** Policy state, offline replay and shadow mode | CLOUD + PC | EMT-S02, EMT-S03 | Opus | None for build; one session runs in shadow | `em.policy-state.v1` and `em.policy-audit.v1`; deterministic offline builder; replay evaluator with the six pre-enable checks; shadow mode that logs what the learned policy would choose while the baseline plays. Evidence: same inputs give the same state id; replay never selects a rejected candidate; change-size and no-backsliding checks fail on planted bad policies; audible behaviour unchanged (plan ids identical with shadow on and off). |
| **EMT-S08** Guarded learner and owner decision | PC + owner | EMT-S05, EMT-S07; the minimum data in the design; coordination with EMF-S23 | Opus | **Yes: at least two sessions** (baseline and learned, or A/B) | Owner-activated learned ordering and parameter preferences within the safe set; explore caps; phone and Studio off switch; automatic pause and rollback; audit trail. Evidence: caps and off switch tested; rollback restores baseline plan ids; the owner's recorded decision to keep, revise or switch off. If the minimum data is not reached the slice stays BLOCKED on data, which is an acceptable state. |

Every slice ends with the [repository handoff and mini chat handoff](../WORK_MODEL.md#per-slice-handoff-policy), at `docs/handoffs/EMT-Sxx-HANDOFF.md`.

**Recommended order:** S01 → S02 → S03, then S04 and S06 in either order, S05 when plan replay exists, S07, then S08 only when the data and the owner allow. S01 to S03 are useful by themselves: they make the next listening session produce better evidence.

## Completion criteria

| Check ID | Required result | State |
| --- | --- | --- |
| EMT-C01 | Every completed set handover is logged with its candidate set, choice probability, evaluator readouts and build, rated or not | Pending |
| EMT-C02 | A rating records what it is about and the listening condition; one-tap rating still works; v1 ratings remain readable and unmodified | Pending |
| EMT-C03 | The report states counts, intervals, sessions and pairs, applies the sample rules and makes no pattern claim on too little data | Pending |
| EMT-C04 | Evaluator blind spots are listed individually, and any threshold change is a new version approved by a person | Pending |
| EMT-C05 | Two plans can be compared on the same song pair in hidden order, and self-consistency is reported | Pending |
| EMT-C06 | Song reactions, exclusions and mixability exist and are shown not to enter transition scoring | Pending |
| EMT-C07 | A learned policy is versioned, reproducible, replay-checked, owner-activated, reversible in one tap and never chooses outside the gated set | Pending |
| EMT-C08 | No private rating data, song titles, paths or audio are in the repository | Pending |
| EMT-C09 | Owner accepts, revises or declines the learner after listening | Pending |

## What this campaign must not claim

- That any transition, recipe or threshold **sounds good**. Only the owner's listening says that, and only for what was heard.
- That a difference is "significant", "proven" or general. It reports counts, intervals and probabilities for one listener, a few songs and one build.
- That ratings **measure** quality, or that the evaluator **hears**.
- That unrated handovers were fine.
- That fallback cuts are bad in themselves, when they are heard only on the hardest pairs.
- That phone ratings say anything about bass, mud or loudness.
- That off-policy or replay numbers show the learned policy is better. They show it is safe to try.
- That the learner improved the DJ, unless the owner compared and said so.
- That passing checks on synthetic fixtures qualifies real phones, audio devices, macOS or Linux.
- That a take's rating changed, or that a song is bad, because its transitions were rated badly.
- That a board, RAM, NAV or acceptance record exists for this campaign before one is actually written.

## Reconciliation with EMF (not done here)

This draft edits no other file. If the owner accepts it, these owners need a matching change:

- **EMF-S23** ("transition editor with audition and plan revisions, queue reordering by transition quality, blind A/B listening protocol and rating-driven preference learning, including randomised-parameter exploration"). EMT **supersedes the rating-learning portion**: the blind A/B protocol and its data (EMT-S05), randomised exploration logging (EMT-S02) and preference learning (EMT-S07, S08). EMF-S23 would keep the transition editor, audition and plan revisions, and queue reordering, which should consume EMT-S06 mixability rather than define its own score. Decide which side builds the plan-replay consumer that both the editor and the bench need.
- **EMF-S24** says its seeded exploration is "logged with ratings so S23 can learn from them". That should point to the EMT hearing log and learner rules, and its sweetening and teaser moves need their own rating target so they are not confused with handover ratings.
- **EMF execution order** (S21 → S10 → S22 → S23 → S11 → S12 → S13): say where EMT slices sit. EMT-S01 to S03 can run beside S22; EMT-S08 cannot precede the S23 remainder decision.
- **[S21 planner guide](../S21_TRANSITION_PLANNER.md)** says "There is no learner (S23)" and "S23 is where learning would start". Those pointers would move to EMT. The report `em.transition-report.v1` would be succeeded by `em.rating-assessment.v1`.
- **EMS-S04** (features that differ between rating sets) should share the sample rules, and may receive attribute-level mixability as labelled transition evidence.
- **EMD** rate card and dashboard screens should follow the prompt rules and plain-language formats.
- **Decisions, Current Tasks and the board:** a decision entry for the new campaign and its ID, a Current Tasks pointer if admitted, and board registration through the boards CLI. None of these was done.
- **Document IDs** `EM-D033` and `EM-D034` are provisional and may collide with the concurrent transition engine design.

## Resume and closeout

Read this file, the [design](../RATING_ASSESSMENT_DESIGN.md), the EMF campaign's current checkpoint and [Current Tasks](../CURRENT_TASKS.md). Confirm the owner has admitted the campaign and answered the design's open questions before starting EMT-S01. Inspect the current feedback schema and report in source, since they may have moved on since 2026-11-16.

## Owner decisions (2026-11-16)

EMT stays a **separate campaign** (not folded into EMF-S23). The phone "about" row is accepted. There is **no automatic learner pause**: the learner runs until the owner pauses it; EMT-S08 acceptance must not depend on an automatic pause. The rejected-candidate audition (EMT-S05) is still awaiting an owner decision. See [Rating assessment design](../RATING_ASSESSMENT_DESIGN.md).
