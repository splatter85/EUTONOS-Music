# EMF — Initial infrastructure

Campaign ID: `campaign-emf-001`  
Short ID: `EMF`  
Owner document: this file  
Status: **PLANNED**  
Recorded: 2026-11-03, America/Chicago  
Progress estimate: **unknown**; no runtime, DAW bridge or musical corpus has been implemented/qualified here.

## Outcome

Build the initial infrastructure for an independent, externally state-controlled music player/generator. Demonstrate recorded playback, several procedural musical identities, deliberate hybrid transitions, an understandable browser test app, a persistent local catalogue/history, and a bounded FL Studio authoring MCP integration.

The engine should be useful with approved local content and without a running model or DAW. Optional production adapters prepare future content outside the real-time path. A separate external application can control the same state interface as the test app.

## Scope and authorization

The initial owner request authorizes this public documentation baseline, production guides, queue and campaign. EMF00 records that completed planning work. The remaining stages are an implementation plan to pick up when implementation is selected. Stage order and a “ready” handoff do not create authority to install software, operate a DAW, publish audio or purchase services.

This is an EUTONOS-style readable campaign with stable IDs, one status owner, bounded stages, explicit evidence and three named review gates. There is no native EUTONOS board configuration or managed-write CLI in this new repository. Do not invent a native receipt or hand-author a fake structured native board. If native tooling is adopted later, preserve these IDs as aliases and migrate once through the supported route.

## Inputs

- [Product goal and requirements](../PRODUCT_GOAL.md).
- [Architecture](../ARCHITECTURE.md), [library/transitions](../LIBRARY_AND_TRANSITIONS.md), [state/API](../STATE_AND_CONTROL_API.md), and [test app](../TEST_APP.md).
- [FL Studio integration](../FL_STUDIO_INTEGRATION.md), [vocal/model options](../VOCALS_AND_MODELS.md), and [production guides](../guides/README.md).
- [Validation plan](../VALIDATION.md).
- An inspected local production/playback environment and explicitly eligible source material, obtained during the implementation stages.

## Initial release boundaries

Include the smallest implementation that proves the musical and operational contracts. Qualify a named Windows reference environment first; other platforms receive explicit tested/untested status.

The first release may have a small library. It must support real expansion, multiple recipe identities and bounded history, but it does not claim three days of distinct music. Full genre coverage, a large distributable library, universal seamless transitions, remote audio streaming, automatic mastering and unrestricted DAW control are outside this campaign's acceptance.

## Stage map

Each ID is stable. Stage position is not effort percentage. All stages other than EMF00 are **PLANNED**. A stage can be split only when a separable outcome or failure boundary warrants it; record the relationship and preserve existing evidence.

| Stage | Outcome | Depends on | Exit evidence |
| --- | --- | --- | --- |
| **EMF00** | Documentation and research baseline | Owner brief | Navigable product/architecture/guides/campaign/examples; document review and publication readback. **Complete for documentation only.** |
| **EMF01** | Campaign adequacy review | EMF00, actual repo/environment intake | Bounded KEEP/CHANGE/DEFER findings; smallest credible implementation plan and open decisions. |
| **EMF02** | Production and fixture baseline | EMF01 | Actual FL/version/capability inventory, three proposed musical families, eligible original fixtures, rights scope and one repeatable export. |
| **EMF03** | Audio backend decision | EMF01, basic fixtures | Native/browser comparison for scheduled two-source playback, procedural role, lifecycle and resource use; one selected initial backend. |
| **EMF04** | Executable scaffold | EMF02–03 | Local service, one playback owner, basic asset load/play, browser connection and operation receipts; no broad feature layering yet. |
| **EMF05** | Scaffold correctness and efficiency review | EMF04 | Review actual ownership, callback/control separation, data flow, packaging, recovery and simpler alternatives; corrections re-reviewed. |
| **EMF06** | Versioned library and importer | EMF05 | Validated manifests, hashes, eligibility, cue/harmony annotations, rebuildable index and a useful error report. |
| **EMF07** | Transport and state lifecycle | EMF05–06 | Shared audio/musical timeline, requested/planned/audible state, dwell/hold, revision/expiry and restart semantics. |
| **EMF08** | Manual listening app | EMF07 | State selector and named sliders, actual/pending display, explicit transport, save-vibe and basic audition workflow. |
| **EMF09** | Recorded transition path | EMF06–08 | Reviewed phrase mix, role substitution and fallback on fixtures, with measured timing and listening notes. |
| **EMF10** | Procedural recipe performer | EMF06–08 | Several distinct authored recipes, reviewed palettes, deterministic symbolic variation, bounded voices/effects and seed audition results. |
| **EMF11** | Hybrid musical handoffs | EMF09–10 | Recorded → procedural → different recording, shared context, explicit bass/vocal/tail ownership and latency alignment. |
| **EMF12** | DJ selection and persistent history | EMF11 | Eligibility filtering, recency/diversity selection, favorites, bounded logs and reproducible source/seed history. |
| **EMF13** | Transition graph and coverage | EMF12 | Directed routes, bridges, dead-end diagnosis and an eligible-library coverage report; no false “all assets always reachable” claim. |
| **EMF14** | External API and playback MCP | EMF07–13 | Independent client drives the same contract; duplicate/retry/conflict/reconnect/hold scenarios verified. |
| **EMF15** | Bounded FL Studio MCP bridge | EMF02, EMF05 | Capability discovery, supported note/edit workflow, apply/readback behavior, export plan and artifact evidence in a disposable project copy. |
| **EMF16** | Optional production-job boundary | EMF06, EMF15 | One selected local/agent production route or an explicit unsupported status; queued jobs, provenance, cancellation/reconciliation and review before eligibility. |
| **EMF17** | Final assembled implementation review | EMF06–16 | Bounded whole-system review of public paths, interactions, remaining risks and qualification scope; material corrections re-reviewed. |
| **EMF18** | Windows listening and operational qualification | EMF17 | Named environment, required failure scenarios, real-session listening and endurance evidence for the initial supported scope. |
| **EMF19** | Owner acceptance and release handoff | EMF18 | Owner listening decision, exact accepted limits, supported setup, known issues and selected next work. |

Stages with independent prerequisites may be investigated in parallel after scope is assigned. Do not bypass a review or start dependent implementation while a material contract correction remains unresolved.

## Named review gates

### EMF01 — campaign adequacy review

**Scope:** the owner's required experience, current repository, actual FL/playback environment, candidate dependencies, required content and consumers. Challenge assumptions that would require a general DAW automation platform, a universal music model, or multiple production backends before the first audible result.

**Prerequisites:** EMF00, current source read, and enough environment discovery to distinguish documented capability from installed capability.

**Exit:** KEEP/CHANGE/DEFER findings, revised stage boundaries if needed, first fixtures/backend spike plan, and a single next executable stage. Planning review in this documentation turn is not a substitute for this environment-aware gate.

**Model preference:** higher-capability model for independent review, advisory; actual owner choice and availability govern.

### EMF05 — scaffold correctness and efficiency review

**Scope:** real scaffold code and immediate consumers: audio callback, scheduler, transport ownership, IPC/API, browser session, file/index handling and packaging. Look for duplicate clocks, Python/UI/model work in real-time rendering, unbounded queues, uncertain retry behavior and simpler alternatives.

**Prerequisites:** a runnable scaffold and its actual test evidence.

**Exit:** a bounded list of material corrections or KEEP, with re-review of changed contracts before substantial dependent layers. Do not turn the review into unrequested implementation.

**Model preference:** higher-capability model, advisory.

### EMF17 — final assembled implementation review

**Scope:** recorded/procedural hybrid playback, graph/selection/history, browser/external controls, FL bridge, production jobs, eligibility and recovery across their boundaries.

**Prerequisites:** implementation stages complete for their declared scope, exact source pins and observed evidence available.

**Exit:** KEEP/CHANGE/DEFER, corrected material issues re-reviewed, and a qualification plan matching the actual supported paths. The review cannot declare subjective music acceptance for the owner.

**Model preference:** higher-capability model, advisory.

## Completion criteria

| Check ID | Required result | Initial state |
| --- | --- | --- |
| EMF-C01 | Reproducible setup and one selected reference playback backend | Pending |
| EMF-C02 | Externally requested states with visible pending and audible outcomes | Pending |
| EMF-C03 | Several distinct musical recipes and a reviewed recorded/stem fixture set | Pending |
| EMF-C04 | Recorded/procedural/recorded handoffs and at least one non-direct bridge | Pending |
| EMF-C05 | Persistent catalogue/history, identity/seed replay and eligibility filtering | Pending |
| EMF-C06 | Transition route/coverage diagnostics and intentional fallback behavior | Pending |
| EMF-C07 | Useful bounded FL authoring MCP operation with actual artifact readback | Pending |
| EMF-C08 | Optional producer jobs cannot interrupt audio or silently admit unreviewed output | Pending |
| EMF-C09 | Three named reviews completed for the implementation they cover | Pending |
| EMF-C10 | Required failure/recovery, resource and listening checks on the reference environment | Pending |
| EMF-C11 | Current docs and setup reflect implemented behavior and known limitations | Pending |
| EMF-C12 | Explicit owner acceptance of the initial musical experience | Pending |

A verified check requires linked evidence. Related stage completion does not automatically verify every parent check. All required checks and EMF19 must be satisfied before the campaign is completed. A model route can remain unsupported if that limit is explicit and instrumental playback/production boundaries are accepted; this does not count as shipping singing capability.

## Current checkpoint

- **Completed:** EMF00 documentation baseline and source research. This is design material, not audio or runtime acceptance.
- **Implementation:** not started.
- **Native board filing:** not available/configured in this repository; readable owner used.
- **Git delivery:** inspect the published commit containing this baseline. Do not infer future branch integration from this document.
- **Effort estimate:** unknown because backend selection, FL host compatibility, musical assets and listening iteration have not been measured.
- **Next stage:** EMF01, when implementation is selected.

## Resume instructions

1. Inspect current branch/head and working changes; preserve unrelated work.
2. Read the goal, this checkpoint and the next stage's canonical documents.
3. Verify any claimed completed artifact at its recorded revision; assess current applicability separately.
4. Record the assigned scope and the next concrete check before substantive implementation.
5. If a write/tool outcome is unknown, inspect actual effects before retrying; preserve operation IDs.
6. Update this owner at meaningful checkpoints and keep Current Tasks as a concise pointer.

## Stage closeout

Report the practical result, meaningful checks and remaining limits; stage position out of the current map; estimated overall effort with its basis or unknown; plan unchanged/updated/review due; any instruction changes; and the next stage's prerequisites/purpose. Keep native filing, commit/publication, integration, runtime qualification and owner acceptance as separate facts.

The default implementation work can use a capable coding model. Music judgment should use actual listening and the owner's preferences. More reasoning or a larger model does not substitute for audition evidence.
