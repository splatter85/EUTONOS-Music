# EMF — Initial infrastructure

Campaign ID: `campaign-emf-001`  
Short ID: `EMF`  
Owner document: this file  
Status: **PLANNED**  
Recorded and revised: 2026-11-03, America/Chicago  
Progress estimate: **unknown**; no runtime, musical corpus or DAW bridge has been implemented or qualified.

## Outcome

Build the initial music player/generator for EUTONOS Mission Control, retaining neutral state and content contracts so future growth is possible. Demonstrate quality recorded playback, several authored procedural identities, deliberate hybrid transitions, understandable controls, persistent catalogue/history and a bounded FL Studio authoring MCP path.

A useful Mission Control pilot comes before the full authoring bridge. This is a delivery milestone inside the campaign, not cancellation of EMF15/EMF16 or a claim the whole campaign is finished. The full acceptance contract below retains those outcomes.

## Scope and authorization

EMF00 preserves the completed initial documentation baseline. The current owner clarification authorizes answering the design challenges and adjusting the GitHub documentation. It does not start runtime implementation, installation, model downloads, DAW operations, publishing audio, purchases or changes to the separate Mission Control repository.

When implementation is selected, follow its assigned scope without needless per-stage permission requests. Stage ordering is dependency/priority, not automatic dispatch. This new repo has readable EUTONOS-style owners, not native board configuration. Keep the existing IDs; do not fabricate a native filing or RAM receipt.

## Inputs

Read [Product goal](../PRODUCT_GOAL.md), [First playable](../FIRST_PLAYABLE.md), [Architecture](../ARCHITECTURE.md), [Library/transitions](../LIBRARY_AND_TRANSITIONS.md), [State/API](../STATE_AND_CONTROL_API.md), [Test app](../TEST_APP.md) and [Validation](../VALIDATION.md). The [40-question review](../reviews/MISSION_CONTROL_FIRST_REVIEW.md) explains the revised delivery sequence. FL/model stages additionally read [FL integration](../FL_STUDIO_INTEGRATION.md), [Vocals/models](../VOCALS_AND_MODELS.md) and the relevant [guides](../guides/README.md).

Actual workstation, FL version, musical assets and Mission Control interface must be inspected when implementation starts. Published upstream documentation does not prove their installed state.

## Delivery milestones

**M1 — audible proof:** EMF01–EMF05. Two recordings, one credible procedural identity, variations, a roughly twenty-minute controlled journey, manual state/hold and deliberate handoffs. A minimal actual MC state adapter is included where available; simulation is labeled and cannot satisfy real integration. Review the result before broadening.

**M2 — usable Mission Control pilot:** EMF06–EMF14 plus their targeted runtime/listening checks. Several musical families, small approved pack, simple controls, history, real MC integration and failure isolation. No FL MCP or model dependency for listening. Pilot acceptance is scoped; it is not the final campaign/release gate.

**M3 — authoring and production:** EMF15–EMF16. Retain bounded FL automation and optional production-job isolation. Advance a narrow authoring helper only when a concrete fixture-production bottleneck warrants it.

**M4 — assembled qualification and acceptance:** EMF17–EMF19. Full reviewed scope, Windows evidence and explicit owner handoff.

The twenty stage identities remain useful checkpoints, not twenty independent product launches or mandatory chats. Stage count is not an effort estimate. All future work below is still planned.

## Stage map and sole status owner

| Stage | Status | Outcome | Depends on | Exit evidence |
| --- | --- | --- | --- | --- |
| **EMF00** | **COMPLETE — documentation only** | Original documentation/research baseline | Initial owner brief | Baseline `ee7125e` and retained [Progress](../PROGRESS.md) evidence. |
| **EMF01** | PLANNED | Campaign adequacy review | EMF00, actual environment intake | Bounded KEEP/CHANGE/DEFER findings and the smallest audible investigation. This paper review does not close the host-aware gate. |
| **EMF02** | PLANNED | Production and fixture baseline | EMF01 | Small eligible original fixture set, sound palette, actual production inventory and one repeatable export; manual FL work is valid. Broader families are completed before M2. |
| **EMF03** | PLANNED | Audio backend decision | EMF01, basic EMF02 fixtures | Investigate Web Audio first; select one renderer using timing/lifecycle/resource evidence. Native only if justified. |
| **EMF04** | PLANNED | Executable scaffold | EMF02–03 | One playback owner/clock, basic control and an audible recorded → procedural → different-recording proof, with minimal MC explicit-state route or visibly incomplete simulation. |
| **EMF05** | PLANNED | Scaffold correctness and efficiency review | EMF04 | Review actual ownership, musical proof, callbacks, recovery, consumer path and simpler options before dependent breadth. |
| **EMF06** | PLANNED | Versioned library and importer | EMF05 | Readiness-dependent metadata, hashes, intended-use eligibility, cues and useful errors; no mandatory annotation wall. |
| **EMF07** | PLANNED | Transport and state lifecycle | EMF05–06 | Requested/planned/audible state, musical dwell, bounded wait, hold, duplicate/revision/expiry and restart behavior. |
| **EMF08** | PLANNED | Manual listening app | EMF07 | Simple MC-facing panel plus advanced lab, pending display, skip/favorite, save-vibe and accessible controls. |
| **EMF09** | PLANNED | Recorded transition path | EMF06–08 | Reviewed phrase mix, role substitution and safe fallback, extending the thin proof. |
| **EMF10** | PLANNED | Procedural recipe performer | EMF06–08 | At least three distinct families, palettes and bounded development; selected and held-out seeds heard across supported states. |
| **EMF11** | PLANNED | Hybrid musical handoffs | EMF09–10 | Generalize the small proof within supported content; verify shared context, bass/vocal/tail ownership and latency alignment. |
| **EMF12** | PLANNED | DJ selection and persistent history | EMF11 | Deterministic eligibility/recency/preference rules, fixed-state identity changes, replayable versions/seeds and bounded logs. |
| **EMF13** | PLANNED | Transition graph and coverage | EMF12 | Directed continuation/bridge routes and dead-end/coverage diagnosis, not all-pairs discovery or universal compatibility. |
| **EMF14** | PLANNED | External API and playback MCP | EMF07–13 | Harden the early adapter: actual Mission Control consumer, shared contract, retry/conflict/reconnect/hold, failure isolation and supported playback-agent tools. |
| **EMF15** | PLANNED — after M2 | Bounded FL Studio MCP bridge | EMF02, EMF05 | Actual capability discovery, supported project-copy edit and artifact readback, including uncertain-outcome reconciliation. |
| **EMF16** | PLANNED — after M2 | Optional production-job boundary | EMF06, EMF15 | One selected production route or explicit unsupported provider state; preparation, cancellation, provenance and review cannot interrupt playback. |
| **EMF17** | PLANNED | Final assembled implementation review | EMF06–16 | Review actual combined paths, including authoring and MC integration; re-review material corrections. |
| **EMF18** | PLANNED | Windows listening and operational qualification | EMF17 | Named environment, real work sessions, recovery/load evidence and scope-matched endurance. |
| **EMF19** | PLANNED | Owner acceptance and release handoff | EMF18 | Explicit listening decision, accepted limits, verified target state, setup/known issues and selected next work. |

Independent work may proceed within an assigned scope when prerequisites and write boundaries permit. Do not skip a material review correction or interpret the review table as approval of untested code. A usable pilot needs targeted checks and owner listening feedback before use; it does not wait for authoring extensions but does not inherit full release acceptance either.

## Named review gates

### EMF01 — campaign adequacy review

Scope: intended MC experience, actual source/consumer/FL environment, fixtures and candidate renderer. Challenge the need for a general production platform before sound. Prerequisites: source inspection and enough real environment evidence to distinguish available capability from documentation. Exit: KEEP/CHANGE/DEFER, bounded fixture/backend plan and one next executable step. The documentation review is an input, not evidence the environment was checked. Model preference: higher-capability, advisory; owner choice and actual availability govern.

### EMF05 — scaffold correctness and efficiency review

Scope: actual renderer/clock, control/MC path, prepared musical handoffs, file/data handling, startup and recovery. Prerequisite: runnable scaffold and recorded execution/listening evidence. Exit: small set of material corrections or KEEP; affected contracts re-reviewed before broadening. A poor musical result should trigger a targeted music change, not another layer of framework. Model preference: higher-capability, advisory. Independent review is required for this gate where the assigned review contract calls for it; no such review occurred in this docs-only update.

### EMF17 — final assembled implementation review

Scope: recorded/procedural DJ, library/history/graph, MC and agent controls, FL bridge, production jobs, eligibility and recovery. Prerequisites: completed implementation for the declared scope and source-pinned evidence. Exit: KEEP/CHANGE/DEFER and qualification matching actual behavior. Do not infer the owner's taste approval. Model preference: higher-capability, advisory.

Reviews are bounded review-only checkpoints; they do not silently implement or widen scope. Preserve unaffected evidence and re-review material fixes. Safety checks required earlier are not delayed to a named gate.

## Full campaign completion criteria

These IDs and meanings are retained. M1 and M2 are smaller milestone evidence, not a waiver of the campaign contract.

| Check ID | Required result | State |
| --- | --- | --- |
| EMF-C01 | Reproducible setup and one selected reference playback backend | Pending |
| EMF-C02 | Externally requested states with visible pending and audible outcomes, including actual MC | Pending |
| EMF-C03 | Several distinct recipes and a reviewed recorded/stem fixture set | Pending |
| EMF-C04 | Recorded/procedural/recorded handoffs and at least one non-direct bridge | Pending |
| EMF-C05 | Persistent catalogue/history, identity/seed replay and eligibility filtering | Pending |
| EMF-C06 | Transition route/coverage diagnostics and intentional fallback | Pending |
| EMF-C07 | Useful bounded FL authoring MCP operation with actual artifact readback | Pending |
| EMF-C08 | Optional producer jobs cannot interrupt audio or silently admit output | Pending |
| EMF-C09 | Three named reviews completed for the implementation they cover | Pending |
| EMF-C10 | Required failure/recovery, resources and listening checks on the reference environment | Pending |
| EMF-C11 | Current docs/setup match implemented behavior and limitations | Pending |
| EMF-C12 | Explicit owner acceptance of the initial musical experience | Pending |

All required checks and EMF19 must be satisfied for full completion. A provider may remain unsupported with an explicit limit; that does not remove the production-boundary test or claim singing has shipped. Three-day breadth, arbitrary-song accompaniment, all genres, all FL actions, remote streaming and a broad public pack catalogue are later outcomes, not hidden criteria for the first pilot.

## Current checkpoint

EMF00's original documentation result is preserved. This revision adds [EM-REVIEW-001](../reviews/MISSION_CONTROL_FIRST_REVIEW.md), answers forty questions, retains ten strengths and changes sequencing around first sound and MC. No implementation stage or runtime completion check has been closed. No audio was generated, rendered or listened to; no local environment/MC source integration was performed. Native board filing is unavailable here; readable owners are used.

Next: when implementation is selected, EMF01 inspects the actual environment, then EMF02/EMF03 prepare the small musical proof. Overall effort remains unknown. Review documents and number of stages are not estimates of runtime completion.

## Resume and closeout

Inspect branch/HEAD/working changes and preserve unrelated work. Read the current goal, first-playable contract and selected stage. Verify old evidence at its original version and assess current applicability separately. Record the assigned scope and next check before substantive work. Reconcile uncertain side effects before retrying; do not invent operation identities.

At a meaningful checkpoint report practical outcome, checks/limits, position in the current milestone/stage map, effort with basis or unknown, plan assessment, instruction changes and the next concrete step. Keep native filing, Git publication/integration, installation, runtime qualification and owner acceptance separate. Actual listening—not model size or reasoning effort—determines musical acceptance.
