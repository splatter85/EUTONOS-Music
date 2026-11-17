# Rating assessment design

Document ID: `EM-D033` (provisional; the coordinator confirms the number at merge)  
Status: **PROPOSAL, design only, 2026-11-16.** Nothing here is built. No schema, report, prompt or learner described below exists yet.  
Campaign: [EMT taste and rating assessment](campaigns/EMT_TASTE_ASSESSMENT.md) (draft, PLANNED)

This document answers the owner's question: **how do we assess the song ratings and the transition ratings?** It covers what a rating is evidence of, how to read a small number of ratings honestly, how ratings and the evaluator check each other, how song ratings and transition ratings stay separate, and what a later learner may and may not do.

It builds on what exists today:

- Transition ratings: `em.transition-feedback.v1` (love, like, ok, dislike, 15 reason tags, a note, `pc` or `phone`), written by the phone relay to a local, gitignored file. See [S21, Transition feedback and report](S21_TRANSITION_PLANNER.md#transition-feedback-and-report) and [S17 phone listening](S17_PHONE_LISTENING.md).
- The descriptive report `em.transition-report.v1` (`npm run transitions:report`): counts only, "too small" below 20 plans or 5 per group.
- Plan records `em.transition-plan.v1` with seeded explore (`explore-bounds@1`) and the rejected candidates.
- The evaluator: frozen `mix-evaluation-thresholds@1` and the separate `transition-safety@1` set, neither calibrated against listening.
- Song ratings: Music Studio takes rated love, like or dislike, exported and imported under the [rated-takes contract](S16_RATED_TAKES.md); [set mode](S18_SET_MODE.md) plays love and like takes only.

Facts that shape everything below: one listener; listening happens occasionally, at stable build points; ratings are sparse; there are no stems; everything stays local.

## 1. What a rating is evidence of

A rating is **one person's reaction at one moment to everything they were hearing**. The handover is only one part of that. A design that treats "dislike" as "this recipe is bad" will be wrong often.

### What goes into one tap

| Source | Example | Can we separate it? |
| --- | --- | --- |
| The handover itself | abrupt, muddy bass, audible tempo change | Yes: this is the target. |
| The two songs | the owner likes B more than A, so B arriving feels good | Partly: ask what the rating is about; compare plans on the **same song pair**. |
| The song pair | two songs that never sit well together whatever the recipe | Partly: keep the pair as its own factor; never credit or blame the recipe alone. |
| Position and order | the third blend in a row feels boring; the first handover gets more attention | Partly: log position in the set and the previous recipe. |
| Mood, attention, fatigue | rating while working; tired after 40 minutes | Only by an owner-declared listening tag and session length. |
| Playback chain | lossy phone stream and small speakers hide bass and mud; PC speakers reveal them | Yes: `device` exists; add a listening condition. |
| Volume | louder often sounds better | No measurement of the phone's volume exists. Declared tag only. |
| Timing of the rating | rated 5 minutes later from memory | Yes: log the delay. |
| Which transitions get rated at all | the owner reaches for the phone when something is very good or very bad | Only by logging **every** handover, rated or not. |
| What the DJ was able to try | a clean cut appears only after other candidates failed | Yes: this is recorded (`fallbackAfterFailedChecks`), and it must be read as a confound (section 2). |

### Protocol and UI changes that disentangle these

1. **One tap stays the default.** Love, Like, OK, Dislike on the last completed handover, exactly as now.
2. **Say what the rating is about (optional, one extra tap).** A small row under the buttons: *The handover* (default), *The song*, *Both*, *Not sure*. A rating marked *The song* never enters transition scoring. A rating marked *Not sure* is kept and shown, but counted separately.
3. **A separate song reaction.** A plain thumb on the Now Playing card ("love this one here", "tired of this one", "don't play this"), stored as its own record. Having somewhere to put a song opinion is the main defence against it leaking into the handover rating.
4. **Listening condition, set once per session.** *Focused* or *Background*, plus the output the owner is hearing (*PC speakers*, *headphones*, *phone*). It stays until changed. *Unknown* is allowed and is the default.
5. **Rate-later queue.** The last few completed handovers stay listed with their song names and time, so the owner can rate one that passed while busy. A late rating is marked with its delay.
6. **Rate the handover, not the set.** No overall set score is requested. If one is added later it is a separate record and is never divided among the transitions.
7. **Offline A/B on the same song pair (the strongest evidence).** The bench renders two candidate plans for the same exit of A and the same B, plays them in a hidden random order, and asks *First*, *Second* or *No difference*. The song pair, mood, volume and device are the same for both, so the answer is about the handover. This needs a consumer for `replayOverrides`, which has none today.
8. **Record every handover, rated or not.** A "hearing" record per completed handover makes the unrated ones visible. Without it we cannot tell "the owner only rates disasters" from "most handovers are disasters".
9. **Stamp the build.** Every hearing carries the policy, planner, analysis, choreography and safety versions (already in the plan record) and a build id. Ratings are compared within a build era first.

### What a rating is not

- Not a listening qualification of the system, and not acceptance of a slice.
- Not a measurement. "Dislike" with the tag *bass clash* says the owner reported it; it does not say the low band rose by some number of dB.
- Not a general result. It is one listener on a few generated songs.
- A phone rating is not evidence about bass, mud or stereo problems. It is acceptable evidence for timing, entry spot, energy and abruptness.

## 2. Assessment methods for sparse, noisy, single-rater data

### Units and effective sample size

- The unit of evidence is a **hearing**: one completed handover the owner heard. The same plan heard twice is two hearings. Today a rating is keyed by plan id, and a later rating of the same plan replaces the earlier one; that loses repeat hearings, which are exactly what a consistency check needs.
- Ratings from one session are not independent (same mood, same volume, same songs). Report three counts side by side: hearings, **distinct song pairs** and **distinct sessions**. A group of 12 ratings from one evening on three pairs is closer to n = 3 than n = 12.

### What to compute

Collapse the four-point scale into two yes/no questions, because four categories with a dozen ratings cannot support an ordinal model:

- **Disliked share**: dislike ÷ all.
- **Liked share**: (love + like) ÷ all. "OK" is neither.

For each group (recipe family, choreography, tempo band, and so on) report:

1. The raw count, written as a count: "4 of 5 disliked", never "80%" alone.
2. A **shrunk estimate with an interval**, from a Beta-Binomial model. The prior is centred on the rate across all rated hearings in the same build era, with a weight of 4 imaginary hearings. In plain terms: a group with 2 ratings stays close to the overall rate, and a group with 30 ratings speaks for itself. Report a 90% credible interval.
3. The number of distinct pairs and sessions behind it.

A worked example with a flat prior: 4 dislikes out of 5 gives a 90% interval of roughly 0.42 to 0.94 for the true dislike rate. The honest sentence is "probably disliked more often than not, but it could be anywhere from 4 in 10 to 9 in 10". It is not "80% disliked".

**Pooling across families.** Recipes sit in families (blends with choreographies; echo family; tempo-move family; cuts). A two-level version of the same model lets a rare recipe borrow from its family before it borrows from the overall rate. This is worth building only when at least three families each have 10 or more rated hearings; before that, the single-level shrinkage above is enough.

**Comparing two groups.** Report the difference in disliked share, its 90% interval, and the probability that one is really worse than the other. No p-values and no "significant".

**Paired A/B results.** Count wins among trials with a preference; report "no difference" separately. With a flat prior: 4 wins of 5 gives about an 89% chance that the plan is really preferred; 5 of 5 gives about 98%; 6 of 8 about 91%; 7 of 8 about 98%. Paired trials therefore reach a usable answer with far fewer listens than unpaired ratings, which is why the bench matters.

### Minimum sample rules

| Evidence | What may be said |
| --- | --- |
| Fewer than 5 hearings in a group | Individual anecdotes. List them; draw nothing. |
| 5 to 9 hearings | "Leaning", and only if the 90% interval excludes the overall rate. |
| 10 or more per group, 20 or more in total, from at least 2 sessions and 3 song pairs | A **pattern**. May be reported and may nominate a question for the A/B bench. |
| A pattern, plus a paired A/B result of at least 90% probability over 5 or more trials on 3 or more pairs | A **finding**. May support a proposed recipe or threshold change. |
| Anything from one session only | Never more than "leaning". |

The existing report limits (20 total, 5 per group) stay as the first tier.

### What not to conclude

- **Do not read one dimension alone.** Recipe, tempo band and choreography are chosen together by the policy. "Brake is disliked" may mean "gaps above 25% are disliked". Always show recipe **within** tempo band, and say when a cell is empty.
- **Cuts after failures (survivorship).** A clean cut is reached only after other candidates were rejected, so cuts are heard mostly on the hardest pairs. "Cuts are rated worst" is evidence about hard pairs plus cuts, not about cuts. Compare fallback cuts with other handovers **on pairs of similar difficulty**, and with owner-chosen cuts when any exist.
- **The gate hides what it rejects.** The owner never hears a candidate the pre-check failed. Live ratings therefore cannot show that a gate is too strict. Only the bench can, by auditioning a rejected candidate on purpose.
- **Unrated is not neutral.** Do not treat an unrated handover as "OK". Report the rated share, and whether it differs by recipe.
- **No taste claims beyond this owner, these songs, this build.**
- **No trend from two build points.**
- **Implicit signals are logged, not scored.** Pressing Next or Hold soon after a handover might mean dislike, or might mean the phone rang. They are recorded for later study and stay out of every score until a check against explicit ratings shows they mean something.

### Exploration logging, so later estimates are valid

To estimate later "what would have happened under a different policy", each choice must record how likely it was.

- Log the **candidate set** that passed the gates, each candidate's score and rank, which was chosen, and the **probability with which it was chosen** (its propensity) under the policy in force.
- Auto mode today is deterministic: the chosen plan has probability 1 and the others 0. Such data can describe what Auto does, but it cannot estimate what another policy would have done. Only explore decisions, with known and non-zero probabilities, can.
- Therefore explore should pick **uniformly among a small declared safe set** (or with stated weights), and record that probability. An explore draw that is refused and falls back to Auto is recorded as such.
- Be honest about the limit: with tens of ratings, weighted off-policy estimates have very wide intervals. They are a sanity check ("the new policy would not have chosen more of the plans that were disliked"), never proof. The paired bench is the primary evidence.

### Drift, re-rating and self-consistency

- **Eras.** Group ratings by build era. A change of policy, planner, analysis or safety version starts a new era. Older eras are shown, and count at half weight in the prior, never in a finding about the current build.
- **Re-rating.** A changed rating of the same hearing replaces it (as now). A new hearing of the same plan is a new observation.
- **Self-consistency check.** In review sessions, the bench re-presents a few earlier plans without saying so. Report how often the second rating lands on the same side (liked, OK, disliked) as the first. With fewer than 8 repeats, show the pairs and no number. If agreement is low (for example 5 of 10 or fewer on the same side), that is the noise floor: no difference smaller than that disagreement rate is worth acting on, and the report says so on its first screen.
- **Order effects.** The bench randomises A/B order and records it. If "second" wins far more often than "first" across all trials, the report flags an order effect and widens the claims.

## 3. Evaluator metrics and ratings together

The evaluator gives numbers (beat phase error, loudness deviation, low-band build-up, boundary flux, true peak, bass hole and others in `mix-evaluation-thresholds@1` and `transition-safety@1`). The owner gives opinions. Neither is the truth about the other; each can show where the other is blind.

### Calibrating the evaluator against ratings

1. **Store the readouts.** Each hearing keeps the evaluator's metric values for the chosen plan, not only pass/warn/fail. Today feedback stores a status and a short reason.
2. **Per metric, ask one question:** do disliked handovers have worse values than the rest? Report the two medians, and the chance that a randomly picked disliked handover has a worse value than a randomly picked one that was not disliked (0.5 means the metric tells us nothing; 1.0 means it separates them perfectly). Show this only with at least 8 disliked and 8 not-disliked hearings carrying that metric; below that, show the raw values side by side.
3. **Use tags to aim.** Each complaint tag points at a metric family, or at none:

| Tag | Metric that should react | State today |
| --- | --- | --- |
| clashing-beat | beat phase error | measured; unjudged on a requested grid |
| bass-clash | low-band rise, low build-up | measured |
| volume-jump | loudness interpolation, true peak | measured |
| tempo-change-audible | tempo ramp shape, stretch amount | planned values only; no audibility metric |
| clashing-key, vocals-clash | harmonic and vocal clash estimates | **not built** (S21 Part B remainder, and the transition engine design) |
| too-abrupt, too-long, too-short, boring, bad-entry-spot, wrong-energy | none: these are about the plan's shape and the entry choice | not an evaluator matter; they inform recipe and entry policy |

A tag with no metric behind it is a documented blind spot, not an evaluator failure.

### Finding disagreements

Build a small table per build era: evaluator verdict (pass, warn, fallback after fail) against the owner's side (liked, OK, disliked).

- **PASS but disliked (blind spots).** Every one is listed individually with its tags, readouts and listening condition. PC ratings marked *The handover* come first. These are the most valuable records in the whole system: each asks "which metric should have caught this?".
- **WARN but liked.** Candidates for a warning that is too cautious. Listed, not acted on alone.
- **FAIL but would be liked.** Invisible in live play. Reachable only by a deliberate bench audition of a rejected candidate, opted into by the owner, on PC, at a safe volume, and only for failures that are not clipping or true-peak failures.

### From disagreement to a change, without overfitting

- **Frozen sets stay frozen.** A change is a new version (`mix-evaluation-thresholds@2`, `transition-safety@2`), never an edit in place. Old ratings keep the version they were heard under.
- **One change per build point.** At most one threshold or one recipe-parameter change is proposed per stable build, so the next listening session can attribute what it hears.
- **Write the expectation first.** Before listening, record what the change should do ("fewer *bass clash* tags on dense pairs"). Afterwards compare against that, not against whatever looks good.
- **Hold out by song pair.** When a threshold is fitted to ratings, check it on pairs that were left out. With this little data, also require the direction to make physical sense; a threshold that only fits is refused.
- **Loosening needs more than tightening.** Tightening a gate (rejecting more) needs a pattern. Loosening a gate (letting more through) needs a finding from the bench, because live ratings cannot see what the gate hid.
- **Safety limits are never loosened by ratings.** Clipping and true-peak limits protect equipment and ears, not taste.
- **A person approves every version change.**

### Quality dashboard

Two views of one computed result (`em.rating-assessment.v1`):

**The full report** (`npm run transitions:report`, successor of the current one), on the PC:

1. Headline: hearings, rated share, sessions, song pairs, build era, and the noise floor from the consistency check.
2. Things that need no ratings: handovers completed, fallback-cut rate, candidates rejected per handover, pre-check verdict mix, unjudged beat-phase share. These are useful from the first session.
3. Liked and disliked shares with intervals, by recipe within tempo band, by choreography, by entry bucket, by device and condition.
4. Evaluator against owner: the disagreement table and the blind-spot list.
5. Song and pair view (section 4).
6. Policy view: which policy state was in force, the explore share, any rollback.
7. "Read this carefully": the standing caveats, as now.

**The phone summary**: at most five plain sentences and no tables, served by the relay as read-only text. Each sentence carries its counts. If there is too little data it says so in one sentence and stops.

### Alert rules

Alerts are notes for a person. No alert changes the planner. (The only automatic action anywhere is the learner's own pause in section 5.)

| Alert | Rule |
| --- | --- |
| Blind spot | Any PC rating of dislike, about the handover, on a plan the pre-check passed. Added to the blind-spot list at once. |
| Repeat complaint | The same complaint tag on 3 or more hearings of one recipe within one build era. |
| Fallback cuts rising | Fallback cuts are more than 1 in 5 handovers in a session of 10 or more. Needs no ratings. |
| Unjudged grid | More than half of a session's blends had beat phase unjudged. Needs no ratings. |
| Inconsistent ratings | The self-consistency check falls to half or below on 8 or more repeats. The report then downgrades every pattern to "leaning". |
| Unreadable data | Any skipped line in the ratings file, or a record whose plan does not match its id. |
| Phone-only evidence | A pattern about bass, mud or loudness that rests only on phone ratings is labelled "confirm on PC". |

## 4. Song ratings and mixability

### Three different things

| Record | Where it comes from | What it means |
| --- | --- | --- |
| Take rating (love, like, dislike) | Music Studio, usually when the take was made, heard alone | The owner's taste for the song by itself |
| In-set song reaction (new) | Now Playing card during a set | How the song feels in this set, now |
| Transition rating | Rate card after a handover | The handover between two songs |

Set mode already refuses disliked takes at intake. That means in a set the take rating has only two values (love, like), and today's snapshot is small (3 love, 6 like). Song-level statistics will be thin for a long time; the design must not pretend otherwise.

### Mixability

Mixability answers "do these two songs hand over well?", in two layers:

- **Attribute layer (usable early).** Disliked and liked shares by properties of the pair that the analysis already measures or will measure: tempo-gap band, key relation, energy change, density at A's exit and B's entry, and the section type at the entry once structure analysis exists. This layer generalises to pairs never heard together.
- **Pair layer (history, not a score).** For a specific pair, show what happened: "heard 3 times with 2 recipes: liked, liked, OK". A pair gets a mixability estimate only after ratings under at least 2 different recipes; before that, a bad rating is as likely to be the recipe as the pair. The direction matters: A into B is not B into A.

A pair's estimate is the pair's result **after allowing for the recipe used**: compare each rating with what that recipe usually gets, then shrink the pair's average toward zero with the same 4-hearing weight. With one or two hearings per pair this stays near zero, which is correct.

### Ordering and next-song suggestions

- Suggestions rank by **measured compatibility first** (tempo gap the recipes can handle, key relation, energy flow). Rating-derived mixability is a bounded adjustment on top, and each suggestion says why in one line ("close tempo, same key; liked twice before").
- A suggestion is a suggestion. The queue order remains the owner's; Auto's next pick may use the ranking only under the learner rules in section 5.
- Variety is protected: no rule may turn the set into the same few safe pairs. Keep a recent-pair memory and a cap on how much mixability can move a song up.

### Exclusions

- Disliked takes stay excluded by intake, as now.
- "Don't play this" from the Now Playing card adds the song to a local exclusion list that the owner can view and undo. It does not change the Music Studio rating. Only the owner changes that, in Music Studio.
- A song is never excluded automatically because its transitions were rated badly. That is a transition problem until shown otherwise.

### Keeping song liking out of transition scoring

1. **Ask separately** (section 1): the *about* choice and the separate song reaction.
2. **Compare within the pair** wherever possible: bench A/B and repeat hearings of one pair under different plans are free of song liking by construction.
3. **Carry the song ratings as context.** Each hearing snapshots both takes' ratings. The report shows transition ratings split by the incoming song's rating. If handovers into loved songs are rated clearly higher across all recipes, that is a halo; the report says so, and recipe comparisons are then made within that split.
4. **Never the other way round.** Transition ratings do not change a take's rating and are not exported to Music Studio as song taste. The mixability attribute layer may be offered to EMS-S04 as measured context, labelled as transition evidence.

## 5. Learning loop specification

Nothing learns today. This is the contract a learner must meet before it is enabled.

### What the learner may change

- The **order among candidates that already passed every gate**, within the tempo band's allowed recipe list.
- **Parameter preferences inside `explore-bounds`**: choreography among the allowed ones, overlap among 8/16/32 bars, swap time, gap bars, entry among the top candidates, meeting point.
- The **bounded mixability adjustment** in next-song ranking.

### What it may never change

- Any evaluator or safety threshold, or which candidates are rejected.
- The rule that a clean cut is the last resort, and the tempo-band recipe lists themselves.
- Harmony gating and grid-confidence gating.
- Song exclusion, take ratings, volume, Hold, mute and transport.
- Its own explore rate, caps or activation.

### Safety floor

- **Gates first, taste second.** Every candidate is rendered and pre-checked exactly as now. The learner only chooses among survivors.
- **Explore inside the safe set only**, never to try a rejected candidate.
- **Explore rate caps:** off by default; when on, at most 1 handover in 4, never two in a row, never in a session tagged *Background*, never on the first handover of a session.
- **Small steps:** a new policy version may move a candidate by at most one position in an order, and may shift a parameter preference by a bounded amount. Big changes take several versions and several listening sessions.
- **Owner kill switch** on the phone and in Studio: one tap returns to the baseline `transition-policy` at the next plan. It needs no confirmation and survives a reload.
- **Automatic pause:** if 3 of the last 5 handovers influenced by the learned policy were rated dislike, the DJ returns to the baseline, records why and says so on the dashboard. It does not turn itself back on.

### Versioning, rollback and audit

- A learned policy is a data file, `em.policy-state.v1`: its id is a hash of its content; it names its parent state, the learner version, the baseline policy version, the hash and count of the feedback it was built from, the build era, its parameters and its explore settings.
- Building a policy state is offline and deterministic: the same feedback file, learner version and seed give the same state id.
- **Activation is a human act**, recorded in an append-only audit log (`em.policy-audit.v1`) with the time, the state id, the replay evidence shown and who chose it. Rollback is activating the parent or the baseline, also logged.
- Every hearing records the policy state id in force, so any rating can be traced to the policy that produced the plan.
- Live choices stay reproducible: policy state id + seed + the same analysis give the same plan id.

### Offline replay evaluation before enabling

A candidate policy state must pass all of these before the owner is asked to activate it:

1. **Determinism:** two builds from the same inputs match; replaying logged hearings twice gives the same choices.
2. **Safety:** on every logged candidate set it chooses only gated survivors, and never chooses a cut where the baseline did not.
3. **Change size:** it reports how many logged decisions it would change. More than about 1 in 3 is refused as too large a step.
4. **No backsliding:** it does not newly choose any plan the owner disliked, and does not stop choosing plans the owner loved, unless a bench finding supports that.
5. **Evidence:** every changed preference traces to a pattern or finding (section 2). Changes that rest on fewer than the minimum samples are dropped.
6. **Shadow period:** it runs for at least one listening session in shadow, logging what it would have chosen while the baseline plays.

Proposed minimum data before any activation (an owner decision): 40 rated hearings about the handover, across 4 sessions and 10 song pairs, in the current build era, plus at least one bench finding.

### What always stays human-decided

Activating or rolling back a policy; any threshold or safety version; adding or removing a recipe; excluding a song; what counts as a stable build point; whether listening happened; and acceptance of any slice. The learner proposes; the owner decides.

## 6. Data model additions

All proposed. Names follow the existing `em.*.vN` pattern. Every record refuses unknown fields, as v1 does.

### `em.transition-hearing.v1` (new): one line per completed handover, rated or not

| Field | Content |
| --- | --- |
| `hearingId`, `sessionId`, `at` | Unique id for this hearing; the listening session; ISO UTC time |
| `planId`, `plan` | The unchanged `em.transition-plan.v1` record |
| `build` | Build id (short source revision) alongside the versions already in the plan |
| `position` | Index of this handover in the session; seconds since the session started; previous recipe |
| `candidates[]` | Each candidate considered: recipe, parameter digest, rank, score, gate result and reason |
| `chosen` | Index into `candidates`; `decision` (auto, explore, manual, next-pressed, fallback); `propensity` (probability of this choice, or null when unknown); `policyStateId`; explore seed |
| `evaluator` | Thresholds and safety versions; per-metric value and verdict for the chosen plan; pre-analysis readouts when the transition engine supplies them |
| `context` | Song ids and hashes (already in the plan); entry and exit section labels when known; snapshot of both takes' ratings; output (`pc-speakers`, `headphones`, `phone-stream`, `unknown`); condition (`focused`, `background`, `unknown`) |
| `outcome` | Completed or interrupted; Next, Hold or mute within a short window afterwards (logged, not scored) |

### `em.transition-feedback.v2`: v1 plus

| Field | Content |
| --- | --- |
| `hearingId`, `sessionId` | Which hearing this rating belongs to (null for migrated v1 records) |
| `about` | `handover`, `song`, `both`, `not-sure`, `unspecified` |
| `prompt` | `unprompted`, `review-mode`, `rate-later`, `bench` |
| `delaySeconds` | Time from the end of the handover to the rating |
| `output`, `condition` | Copied from the session at rating time |

The key for "latest rating" becomes the hearing, not the plan.

### Other new records

| Schema | Purpose |
| --- | --- |
| `em.ab-trial.v1` | One bench comparison: the two plan ids, the hidden order, the answer (first, second, no difference), whether it was a repeat for the consistency check, session and condition |
| `em.song-feedback.v1` | In-set song reaction: song id and hash, reaction, session, time |
| `em.policy-state.v1` | A learned policy (section 5) |
| `em.policy-audit.v1` | Append-only activations, rollbacks and automatic pauses |
| `em.rating-assessment.v1` | The computed assessment behind the report and the phone summary; replaces `em.transition-report.v1` |

### Migration from v1

- **Never rewrite the existing file.** It stays append-only and readable. The reader accepts v1 and v2 lines; the writer writes v2 only.
- A v1 record is read as v2 with `hearingId` null, `about` `unspecified`, `prompt` `unprompted`, `delaySeconds` null, `output` taken from `device` (`phone` becomes `phone-stream`, `pc` becomes `unknown`) and `condition` `unknown`.
- v1 records count in descriptive tables. They are left out of anything needing a propensity, a hearing or a candidate set, and the report states how many were left out.
- The older `em.transition-ratings.v1` browser log keeps its existing one-time migration into v1.

### Retention, privacy and export

- **Local only.** Everything lives under the gitignored `local/` folder, written only by the relay. Nothing is uploaded or committed, and nothing leaves the PC without the owner's explicit export.
- **No audio, no file paths, no personal data.** Song ids and hashes only, as now. Notes stay capped at 200 characters with control characters removed.
- **Keep everything; delete nothing automatically.** When a file reaches its size cap, start a new numbered file and keep the old one. Deleting is an owner action.
- **Export** is one owner-started JSON bundle of the records above with their schema versions. It is for backup or for moving to another PC, not for publication.
- **Public documents** use made-up or aggregated examples only. No song titles, take ids, notes or rating lines from the local files are copied into this repository.
- **The phone summary** shows aggregate sentences only and goes through the same relay guards as the phone page.

## 7. Owner experience

### Rating stays effortless

- One tap is always enough. Everything else is optional and collapsed.
- The card names the handover being rated and keeps refusing a stale view, as now.
- The rate-later list means a missed moment is not lost.
- The listening condition is asked once per session, not per rating.
- Rating works with the phone locked out of the way: nothing requires looking at the screen during a handover.

### When the DJ may ask

The DJ never interrupts the music, never plays a sound to ask and never sends a notification.

- **Normal listening:** the DJ does not ask. The rate card is simply there.
- **Review mode:** a switch the owner turns on at a stable build point. While on, the card is highlighted after each handover, and the bench offers A/B trials. It turns itself off when the session ends.
- **Outside review mode,** the card may be highlighted at most once per session, and only for a handover that would teach something: an explore choice, or a recipe with fewer than 5 ratings in this build era.
- Never while Hold or mute is on, never in a session tagged *Background*, and never for the same hearing twice.
- If the owner dismisses a highlight twice in a row, highlights stop for that session.
- No streaks, targets or "you have 12 unrated transitions" counts.

### Results in plain language

Every sentence carries its counts and, where needed, its caution. Examples (made-up numbers):

- "Not enough ratings yet to see a pattern: 7 rated handovers in this build. Individual ones are listed below."
- "Cuts after failed checks are rated worst: 4 of 5 disliked. They only happen on the hardest song pairs, so this may be about the pairs."
- "Bass-drop handovers are liked more often than tone-dissolve on close tempos (8 of 11 against 4 of 10, over 3 sessions). Worth an A/B to confirm."
- "On the bench you preferred the 16-bar blend to the 8-bar blend 5 times out of 6, on 4 song pairs."
- "The check passed 3 handovers you disliked. Two were tagged *vocals clash*, which the check does not measure yet."
- "You rated the same handover differently on 4 of 9 repeats. Small differences in this report are within that noise."
- "Phone ratings and PC ratings disagree about bass. Trust the PC ones."

## Relation to other documents

- [S21 transition planner](S21_TRANSITION_PLANNER.md) owns the current feedback schema, report and explore mode. This design proposes their successors and changes nothing there.
- The transition engine design (a separate document, in progress) is expected to supply background pre-analysis and candidate scores. The hearing record has a place for them; this design does not depend on their exact shape.
- [Rated takes](S16_RATED_TAKES.md) and [EMS](campaigns/EMS_MUSIC_STUDIO.md) own take ratings. EMS-S04 compares measured features across rating sets; it should use the same sample rules as section 2.
- The EMF campaign's planned EMF-S23 names blind A/B and rating-driven learning. The [EMT draft campaign](campaigns/EMT_TASTE_ASSESSMENT.md) lists what must be reconciled there.

## Open questions for the owner

1. Is a separate assessment campaign (EMT) wanted, or should these stages be folded into EMF-S23?
2. Are the minimum-sample tiers and the 40-hearing learner threshold acceptable, or should they be stricter or looser?
3. Is the extra *about* row on the phone acceptable, or must rating stay strictly one row?
4. Is review mode the right way to mark a stable build point, or should the DJ never highlight the card at all?
5. May the bench audition candidates that the pre-check rejected (PC only, opt-in, never clipping or true-peak failures)?
6. Should "don't play this" in a set stay local to the DJ, or also be shown in Music Studio?
7. Is an automatic pause of the learned policy (3 dislikes in 5) wanted, or should every change wait for the owner?

## Owner decisions (2026-11-16, in chat)

| Question | Decision |
| --- | --- |
| Optional "about" row on the phone rating card (handover / song / both / not sure) | Yes, keep it. |
| EMT as its own campaign or folded into EMF-S23 | **Separate EMT campaign.** |
| Automatic learner pause after repeated dislikes | **No automatic pause.** The learner keeps running until the owner hits pause (the one-tap kill switch stays). The audit trail and the safety floor (the learner may only reorder candidates that passed every gate) are unchanged. Dislike counts are still shown in the report so the owner can decide when to pause. |
| Audition of candidates the pre-check rejected (PC-only A/B bench) | Pending: the owner asked what it means. Meaning: let a rejected candidate be played for a human A/B comparison to find out whether a safety check is too strict. Clipping and true-peak failures would stay blocked, and the mode would be opt-in and PC-only. |
