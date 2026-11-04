# Mission Control first: 40-question design review

Document ID: `EM-D015`  
Review ID: `EM-REVIEW-001`  
Date: 2026-11-03, America/Chicago  
Inspected baseline: `ee7125e95a0e73a3e6616e7832602b63778e2b03`  
Disposition: **CHANGE the delivery sequence; KEEP the hybrid musical core.**

## Scope and evidence

The owner clarified that the first product is the music player/generator for EUTONOS Mission Control. It could grow into something larger if the experience earns that opportunity. This review answers the design challenges and changes the documentation and campaign; it does not authorize or perform installation, DAW control, model execution, or runtime implementation.

The preceding chat reply displayed only questions 1–5 and the remaining section headings. Questions 1–5 below retain those questions; questions 6–40 complete the intended examination. They are not recovered quotations from a missing list. Answers are design judgments unless a primary source is cited. This is one assistant's source-level review, not an independent review or a listening study. No audio was auditioned.

The baseline already had strong contracts for timing, history, provenance and recovery. Its main weaknesses were delivery emphasis: a general external consumer appeared before the specific Mission Control experience; Mission Control integration was late in the delivery plan; and a full FL authoring bridge was included in first-release expectations. The change is earlier musical proof and consumer fit, not deletion of the larger ambitions.

## Product identity and fundamental assumptions

### Q01 — Are we accidentally building three products when we only need one?

**Answer:** The player, procedural performer and DJ belong together because the requested experience needs them to cooperate. The FL bridge and production guidebook are the workshop that supplies that experience, not a second consumer product that everyone must install. Keep shared asset and recipe contracts, but do not require the production environment to start listening. A future standalone product remains possible without building accounts, hosting, marketplaces or a general agent platform now.

**Disposition:** CHANGE delivery scope, KEEP the components. **Check:** a listener starts an approved pack with FL Studio, models and agent clients closed. **Owners:** Product goal; Delivery plan.

### Q02 — What would make someone choose this over Spotify, YouTube Music, or an ordinary long-form DJ mix?

**Answer:** For the first user, the wager is a soundtrack that fits the current Mission Control session, develops without a conspicuous restart, and lets the listener preserve or redirect the vibe. We do not need to win a general streaming-service comparison. A technically clever generator that is less enjoyable than a chosen mix has not earned its complexity. Compare adaptive playback, fixed-state playback and a chosen ordinary mix in real work sessions; keep the conditions and subjective results visible.

**Disposition:** CHANGE success criteria toward voluntary reuse and listening preference. **Check:** does the owner choose to use it again and why? **Owner:** Validation.

### Q03 — Does adapting to productivity actually make the music better?

**Answer:** Unknown. Typing rate is not productivity, agent activity is not human engagement, and a quiet interval is not evidence of boredom. Adaptation is an optional musical behavior to test, not a promised cognitive benefit. Start with manual profiles, then add a conservative Mission Control adapter. Compare the same content in fixed and adaptive modes at matched listening levels. If fixed mode wins, keep it as a first-class option and revise the mapping rather than claiming users need to learn to like adaptation.

**Disposition:** KEEP adaptation as a hypothesis, CHANGE its status from assumed benefit. **Check:** preference, distraction, unwanted transitions and override reasons. **Owners:** Validation; State/API.

### Q04 — Should this be fundamentally state-driven or listener-driven?

**Answer:** Listener-driven, with state requests as an input. Manual mute, pause, style exclusions and hold outrank automatic intent. Mission Control may request more drive; it does not own the listener's ears. Hold the current vibe by retaining the target character while allowing appropriate musical development. Releasing a hold should consider the current external intent, not replay a backlog. Expose only the distinctions a listener needs; deeper hold modes can remain in the lab.

**Disposition:** KEEP arbitration, simplify its surface. **Check:** rapid automatic requests cannot defeat a manual hold or restart muted playback. **Owners:** State/API; Test app.

### Q05 — What is the smallest demonstration that proves this is worth building?

**Answer:** A roughly twenty-minute, deliberately chosen listening experiment: recorded piece A, a genuinely procedural passage, then different recorded piece B; a small rise and release; a manual hold; and two or three repeatable state changes. Use good sounds and a controlled harmonic/tempo context. Twenty minutes is an experiment format, not a proven quality threshold. The result should expose continuity and taste problems before a large importer, general transition graph, model runtime or DAW automation suite is built.

**Disposition:** CHANGE EMF04 into an audible scaffold, with its existing scaffold-review stage next. **Check:** save the render/event trace and actual listener observations. **Owners:** First playable; Campaign.

## Musical quality, procedural composition and taste

### Q06 — Could technically correct procedural music still be tedious or unpleasant?

**Answer:** Absolutely as a design risk: valid notes and clean timing do not establish musical appeal. Recipes need rhythm, sound, register, articulation, motif development, arrangement and restraint. Treat the generator as an authored performer with bounded choices, not a random note source. Use several seeds selected before listening as well as curated examples. Separate composition, sound and transition faults so each revision changes the right thing.

**Disposition:** KEEP recipe-first design. **Check:** direct listening across held-out seeds and supported controls, with failures retained. **Owners:** Recipe authoring guide; Validation.

### Q07 — Is the quality bottleneck the composition algorithm or the sound palette?

**Answer:** It may be either, or their interaction; diagnose rather than assume. Compare one symbolic pattern through different palettes, and different patterns through one palette, at matched gain. FL Studio can supply rendered parts and original sound design, but the runtime does not inherit its plugins. Start with a small palette that actually sounds good over the intended note range and articulation. A rich sample set will not rescue incoherent arrangement, and good MIDI will not establish a convincing sound.

**Disposition:** CHANGE the first fixture exercise to isolate these variables. **Check:** two controlled A/B comparisons and a usable export. **Owners:** First playable; FL workflow.

### Q08 — How do we encode taste without hard-coding one producer's habits as universal law?

**Answer:** Separate hard validity limits from recipe preferences and listener choices. Timing and asset eligibility are hard constraints; sparse percussion, a particular bass sound or a long breakdown are taste choices. Store style-specific defaults and revision notes. Learn initially from explicit favorites, skips and plain-language feedback, with a way to reset. Do not build an opaque personal-preference model before simple controls and curated recipes have been tested.

**Disposition:** KEEP authored musical identities; DEFER automatic taste learning. **Check:** explain a change and reproduce the version before and after it. **Owners:** Library; Agent music workflow.

### Q09 — Should the musical phrase be allowed to disobey a requested state change?

**Answer:** It should negotiate the execution time. Accept a target promptly, show the pending plan, and finish or bridge the musical phrase within a stated wait budget. Minimum dwell must not become permission to ignore the listener indefinitely. Explicit mute/stop remains immediate in intent with safe short gain handling, not quantized to the end of a song. When the musical route cannot meet the budget, report that and use the selected fallback policy.

**Disposition:** KEEP requested/planned/audible separation; add a bounded transition-wait policy. **Check:** show acceptance time separately from audible start and never falsely label a queued transition complete. **Owner:** State/API.

### Q10 — Can the engine develop an arc while the external state never changes?

**Answer:** Yes by design: the state is an envelope, not a frozen arrangement. It should allow introductions, repetition, development, release and recovery inside the chosen energy/texture limits. A stable Explore session can change motifs, palettes and pieces without becoming Surge. A high-energy session can take a local breath without leaving its overall direction. Novelty, musical tension and drive are distinct controls; none must increase monotonically.

**Disposition:** CHANGE explicit acceptance for fixed-state development. **Check:** a long moderate-state run includes perceptibly different identities without unwanted escalation. **Owners:** Library; Validation.

## DJ intelligence, transitions and long-term variety

### Q11 — Does matching BPM and key make a transition safe?

**Answer:** No such guarantee should be designed into the system. Beat phase, phrase position, actual chord region, vocal timing, bass ownership, timbre and effect tails all matter to the intended handoff. A whole-track key estimate is only a candidate hint. Start with authored cues and a shared chord timeline. Analyze more automatically only when it reduces actual preparation work, and keep the creator's corrections authoritative for the reviewed revision.

**Disposition:** KEEP the detailed transition contract. **Check:** include a same-BPM/same-key pair whose bass or phrases clash and demonstrate rejection or a better handoff. **Owner:** Library and transitions.

### Q12 — Must every track be able to transition directly into every other track?

**Answer:** No. Preserve directed compatibility and let short bridge routes connect musical regions. A bridge can release pitched parts, change rhythmic feel or introduce a new harmonic region. Direct adjacency is not required for eventual reachability. The initial graph can be a few hand-authored routes; do not require all-pairs analysis or a general graph-learning system before the first useful music.

**Disposition:** KEEP directed routes; CHANGE their initial scale. **Check:** A can reach C through B while an unsafe A-to-C overlap stays unavailable. **Owners:** Library; EMF13.

### Q13 — Can generated music accompany any recording automatically?

**Answer:** Not in the first supported scope. Rich accompaniment needs a reliable musical map or deliberately compatible unpitched regions. Classify material as finished playback, cue-mixable, or hybrid-ready. A file with uncertain chords can still be listened to without pretending it supports a generated lead. Co-produced FL fixtures are the most controlled initial hybrid inputs. This preserves the broad library ambition without demanding perfect transcription of arbitrary songs.

**Disposition:** CHANGE metadata requirements to depend on the operation being requested. **Check:** missing harmony disables pitched accompaniment, not ordinary permitted playback. **Owner:** Library and transitions.

### Q14 — How can a procedural passage feel like a continuation rather than a different machine taking over?

**Answer:** Share explicit musical context and transfer roles, not just audio volume. The incoming performer inherits the approved tempo/meter, current harmonic position, palette references and permitted motif material. Assign one bass owner at a time unless an overlap was specifically reviewed. Preserve attacks, pickups and tails; account for path latency. Start with a constrained handoff before attempting cross-genre transformation.

**Disposition:** KEEP the shared-plan architecture. **Check:** recorded-to-procedural-to-recorded transitions with audible context before and after, plus timing and low-end inspection. **Owners:** Architecture; EMF11.

### Q15 — Can a million seeds satisfy the three-day variety goal?

**Answer:** Not by arithmetic alone. Count musical identity at recording, section, motif, recipe and palette levels, and ask whether differences are perceptible and useful. The broad touring policy should cover eligible catalogue regions without violating listener exclusions or state constraints. A small pack is an honest first release, not a substitute for the long-term library. Three-day endurance and three-day musical breadth remain separate acceptance claims.

**Disposition:** KEEP the ambition and evidence distinction. **Check:** replay logs expose repetition and unreachable/excluded content; later sampling covers the beginning, middle and end of long runs. **Owners:** Library; Validation.

## Architecture, performance and reliability

### Q16 — Are we choosing native audio before proving that the browser is insufficient?

**Answer:** The baseline leaned that way. Revise the first experiment to use Web Audio as the lower-setup candidate, with actual scheduling and a representative sample palette. Select one pilot backend in EMF03. Use native playback if the required lifecycle, resource or audio behavior cannot be met, or if playback after the browser closes is selected as a requirement. A browser proof does not establish that lifecycle. Web Audio scheduling and browser lifecycle are documented mechanisms, not project benchmarks. [S1][S2]

**Disposition:** CHANGE the implementation default from presumed native to evidence-selected, browser-first investigation. **Check:** identical fixture, background, reconnect and resource scenarios. **Owner:** Architecture.

### Q17 — What happens when a model, an agent, or FL Studio takes too long?

**Answer:** Nothing should happen to the current playback merely because production is late. Models and DAW work prepare future material; they do not own the audio deadline. Keep a bounded prepared horizon and a valid continuation or ending. Completed jobs enter a review queue and cannot silently swap a live asset. Instrumental playback must remain useful with every production adapter disabled.

**Disposition:** KEEP strict separation of production and playback. **Check:** deliberately stall or disconnect production while a prepared sequence continues correctly. **Owners:** Architecture; EMF16.

### Q18 — What happens after a crash, device change, sleep, or a second browser tab?

**Answer:** Keep one playback owner, a new engine generation after restart, and explicit stopped/resumable states. Tabs attach as controllers; they do not each start their own soundtrack. A browser-only owner reports that it is gone when its page closes; a native owner may continue under an explicit preference. Device loss and resume behavior require named-environment tests. Do not silently restart audio from an old command or a stale resume snapshot.

**Disposition:** KEEP the ownership and recovery model. **Check:** duplicate-tab, device removal, sleep/resume and lost-client cases. **Owners:** Architecture; Validation.

### Q19 — Could music consume the resources the coding agents need?

**Answer:** Yes as a risk to measure. Ordinary playback should not need a GPU or ongoing model calls. Limit voices, read-ahead, decoding, cache and history; isolate optional analysis/generation. Measure on the actual reference machine while representative development work runs, then choose budgets before qualification. If load is excessive, reduce optional layers or postpone production jobs rather than let the soundtrack compete without bounds.

**Disposition:** KEEP bounded resources; DEFER numerical guarantees until measurement. **Check:** baseline versus concurrent-work resource and dropout comparison. **Owners:** Architecture; Validation.

### Q20 — What is the least harmful thing to do when a transition cannot be prepared?

**Answer:** Choose from supported continuity, a prepared alternate, or a deliberate fade/ending; show the reason. Continuing is only possible when the current source has a valid continuation. Never loop a non-loopable tail by accident or join incompatible material merely to satisfy the requested state. Unknown outcomes remain unknown. A failure in optional music must not interfere with Mission Control messaging or work controls.

**Disposition:** KEEP fallback hierarchy; make component isolation a first-consumer requirement. **Check:** missing next asset, exhausted continuation and music-process failure. **Owners:** First playable; Architecture.

## FL Studio integration and agent production

### Q21 — Should the initial music experience wait for a complete FL Studio MCP server?

**Answer:** No. Produce first fixtures manually or with supported scripts and an explicit export recipe. Keep the bounded FL bridge in EMF15 and the full campaign's acceptance, but place it after the usable Mission Control pilot. If authoring repetition becomes the measured bottleneck, advance a narrow bridge operation without expanding into arbitrary GUI automation. This changes dependency order, not the requested feature set.

**Disposition:** CHANGE pilot prerequisites; KEEP authoring work. **Check:** first audible proof runs with no FL MCP service. **Owners:** Delivery plan; Campaign.

### Q22 — What should an agent actually be allowed to change in FL Studio?

**Answer:** Only operations discovered and verified against the intended project and supported host interface. Begin with capability inspection and a bounded note/pattern change in a project copy, then add render preparation and artifact readback. Official Piano roll scripts manipulate notes and markers; that is not proof of unrestricted project control. Preserve current work, serialize editing ownership, and reconcile uncertain results using the original operation ID. [S3]

**Disposition:** KEEP the bounded bridge and staged capability growth. **Check:** wrong-target, stale-project and lost-acknowledgment tests. **Owner:** FL Studio integration.

### Q23 — How does “darker, less busy, but keep the bass” become an actionable instruction?

**Answer:** Translate it into a small, reversible production brief: preserve bass notes and sound; reduce selected percussion activity; try a darker tone or alternate voicing where appropriate; keep tempo and loudness unchanged unless requested. Offer an auditionable revision with a plain-language description of what changed. Ambiguous preferences can be explored through two variants rather than forcing the user to learn parameter names. Accepted material and unrelated parts remain intact.

**Disposition:** KEEP natural-language authoring; prefer evidence from a rendered before/after. **Check:** the preserved part really stays unchanged and the edited target is audible. **Owner:** Agent music workflow.

### Q24 — How do we prevent agents from claiming they made good music without hearing it?

**Answer:** Track evidence types explicitly. Editing MIDI proves note changes; a render receipt proves an artifact exists; waveform measurements prove only their measured properties. An agent that cannot audition should say so and ask for listener feedback on a named excerpt, not invent an aesthetic judgment. Music-theory guides support choices but do not certify the result. Keep musical acceptance separate from infrastructure test success.

**Disposition:** KEEP the existing honesty contract. **Check:** each acceptance note identifies who listened, to which version, or marks listening not evaluated. **Owners:** AGENTS; Validation.

### Q25 — Should we combine every FL MCP project and add every vocal/local model now?

**Answer:** No. Select the smallest useful supported route when its stage begins, pin its version and inspect the behavior we depend on. Existing agents can act as clients; a model provider is an optional production adapter. Keep singing synthesis, full-song generation and voice conversion distinct, with one evaluated route first. The documentation preserves the alternatives without making every option a dependency or an installation promise.

**Disposition:** KEEP research and extensibility; DEFER adapter breadth. **Check:** one real end-to-end authoring result before adding another route. **Owners:** FL integration; Vocals/models; Delivery plan.

## Human interaction and ease of use

### Q26 — Will someone need a manual before they can press Play?

**Answer:** The intended consumer path is choose Music, press Play, optionally choose a vibe. Supply one approved starter pack in the pilot distribution, or clearly state that the current development build needs a private pack. No FL installation, model download, account or theory lesson should be required to listen. Startup should be silent until an explicit play gesture; unsupported playback and missing content should be stated plainly.

**Disposition:** CHANGE onboarding into an explicit acceptance scenario. **Check:** a fresh listener reaches music without a production setup wizard. **Owners:** Test app; First playable.

### Q27 — Are all those sliders useful or just intimidating?

**Answer:** Keep the laboratory rich and the Mission Control panel small. Expose Play/Pause, volume/mute, vibe, energy, variety and Hold by default. Put transition duration, contrast, source mix, tempo movement, density, tension and technical diagnostics behind Advanced/Lab. Disable unsupported controls with a reason. Retain keyboard and accessible labels; communicate pending changes in text instead of expecting the listener to interpret a graph.

**Disposition:** CHANGE presentation, not underlying test capability. **Check:** the basic panel is usable without explaining the detailed musical model. **Owner:** Test app.

### Q28 — What exactly does “Hold this vibe” preserve?

**Answer:** By default hold the current musical character/target while allowing sections and compatible selections to develop. It should not secretly repeat the same eight bars forever. The lab can separately offer hold recipe or hold a bounded moment, stating what is still free to change. The listener can always stop, mute or release; release uses fresh intent. Holding energy does not mean freezing every note or prohibiting an intentional musical breath.

**Disposition:** KEEP distinct semantics; choose one understandable default. **Check:** sustained hold keeps the vibe while the music remains alive. **Owners:** State/API; Test app.

### Q29 — Can someone dislike one passage without banning its entire genre?

**Answer:** Provide Skip now and optional simple reasons such as too busy, wrong mood or dislike this sound. Save feedback against the actual selection/recipe/version, not a global genre stereotype. Make favorites and exclusions reversible. Begin with transparent recency and preference rules; infer less than the feedback actually establishes. A skip caused by an interruption should not become permanent dislike.

**Disposition:** CHANGE initial feedback granularity; DEFER opaque learning. **Check:** one skip affects the current selection without eliminating unrelated material. **Owners:** Test app; Library.

### Q30 — What if the right soundtrack is silence or reduced audio?

**Answer:** Mute and pause are valid outcomes, not engagement failures to counteract. Never automatically raise volume to reclaim attention. Keep music optional and remember the user's explicit stop. Offer manual ducking or a bounded pause when needed; automatic meeting/call detection is later optional integration, not an assumed system-wide ability. Productivity and duration are not retention targets for this feature.

**Disposition:** KEEP listener authority; explicitly reject an attention-maximization objective. **Check:** inactivity or incoming agent traffic cannot override a deliberate mute. **Owners:** Product goal; State/API.

## Mission Control, external state and autonomy

### Q31 — Should every keystroke, token, worker spawn and Crosstalk message change the music?

**Answer:** No. Mission Control should emit coarse, smoothed musical intent from available aggregate signals. Agent throughput and worker counts cannot independently force escalation; user interaction is an optional, imperfect input, not a diagnosis. No typed content is needed. Rate limits, confidence handling and dwell belong to clear owners: the adapter interprets activity, the engine decides musical execution. A trace replay should include noisy and quiet intervals.

**Disposition:** CHANGE integration from broad telemetry ambition to a minimal adapter. **Check:** a background agent flood does not turn quiet reading into Surge. **Owners:** First playable; State/API.

### Q32 — What does the music do when Mission Control is quiet, hidden or disconnected?

**Answer:** Do not equate lack of events with lack of thought. Preserve an explicitly chosen mode; when automatic input loses freshness, keep the active musical plan and settle according to a visible fallback preference. Adapter freshness is different from pending-intent expiry and music dwell. Browser visibility is not a reliable measure of human engagement. Reconnection reports current intent and playback rather than replaying old state changes.

**Disposition:** KEEP state persistence; clarify separate freshness responsibilities. **Check:** disconnect during a transition and reconnect after it completes. **Owners:** State/API; Architecture.

### Q33 — How early should we integrate with actual Mission Control?

**Answer:** During the thin scaffold, using the smallest available explicit state control. By the usable pilot, test the real consumer; a standalone selector alone is insufficient. If Mission Control cannot be reached during a particular experiment, label the test adapter as simulated and keep real acceptance pending. Do not modify the separate Mission Control repository under this documentation assignment. When implementation is selected, inspect its actual current interface rather than inventing endpoints from old plans.

**Disposition:** CHANGE Mission Control from late phase D to an early acceptance consumer. **Check:** actual MC control and disconnect/hold behavior, with provenance. **Owners:** Delivery plan; EMF04/EMF14.

### Q34 — Who wins when the user, Mission Control and an agent send conflicting requests?

**Answer:** A simple fixed priority policy first: listener transport/mute/hold, then the selected automatic source. Other controllers observe or receive an explicit conflict; frequency of messages is not authority. Use caller-known command identities and current revisions, deduplicate before stale checks, and show superseded requests. Do not introduce a distributed multi-user control hierarchy for one local listener. Agent authoring permission remains separate from playback control.

**Disposition:** KEEP the correctness contract, narrow its first deployment. **Check:** duplicate command, stale write and automatic override while held. **Owner:** State/API.

### Q35 — Must an LLM make each DJ decision to make the system intelligent?

**Answer:** No. A deterministic selector with authored compatibility, recency and taste constraints is the initial DJ. A model may help create recipes, suggest catalogue labels or prepare material ahead of time, subject to review. This keeps normal playback independent of provider availability and per-turn costs. Upgrade selection only after a repeatable experiment demonstrates a benefit beyond a simpler rule, with latency and failure behavior included.

**Disposition:** KEEP model-independent runtime; DEFER model-in-the-loop DJ selection. **Check:** equivalent listening session with all agent/model connections disabled. **Owner:** Architecture.

## Ecosystem, rights, evaluation and future direction

### Q36 — Can the purchased FL Studio sounds simply become the public engine's sample library?

**Answer:** Not as a blanket assumption. Image-Line's guidance permits eligible sounds within compositions while restricting isolation or sample-pack redistribution; FL Cloud has explicit sharing restrictions too. Finished music, separated stems and reusable instrument assets need distinct intended-use checks. Use original material with applicable redistribution permission for a public starter pack. Keep private production inputs local and request clarification for uncertain assets. This is a design boundary, not a legal clearance opinion. [S4][S5]

**Disposition:** KEEP provenance, make pack eligibility operational. **Check:** public export rejects private-only or unresolved reusable assets. **Owners:** Library; FL integration.

### Q37 — Does a public repository or an open model settle all code, music and voice rights?

**Answer:** No permission should be inferred from accessibility alone. Keep code/document licensing, media distribution, model/checkpoint terms and singer permissions explicit and version-specific. Do not choose a new project license on the owner's behalf in this review. Voice quality and controllability still need audition evidence. No model weights, private projects or impersonating voice assets are added by this work.

**Disposition:** KEEP the existing rights separation and open licensing decision. **Check:** an artifact has an intended-use basis and source version before release. **Owners:** Vocals/models; Library.

### Q38 — Can a music pack or MCP connection become a route to unsafe computer actions?

**Answer:** Treat media/metadata/lyrics as data, never instructions. Declarative recipes use an allowlisted runtime; arbitrary executable scripts or plugins require a separate explicit trust decision. Keep playback tools unable to edit FL projects or read arbitrary paths. Restrict local file roots, validate requests and authenticate writes. MCP's HTTP guidance includes origin validation and loopback binding; local does not mean permissionless. [S6]

**Disposition:** KEEP isolation; clarify untrusted pack/agent boundaries. **Check:** path escapes, unknown recipe operations and content-origin prompt instructions are rejected. **Owners:** Architecture; State/API.

### Q39 — What evidence should make us simplify or change direction?

**Answer:** If listeners prefer the fixed version, simplify adaptation. If hand-curated stems outperform a procedural passage, improve that recipe or keep it out of the default pack without cancelling procedural research. If the browser misses a required lifecycle behavior, choose the native route. If an authoring task is the bottleneck, automate that task rather than build a broad framework. Preserve failed results and use one bounded next experiment; do not keep adding subsystems to explain away disappointing music.

**Disposition:** CHANGE explicit iteration/stop rules. **Check:** each experiment names the decision it can change and the remaining evidence. **Owners:** Validation; Decisions.

### Q40 — What should happen if this turns out to deserve a bigger product?

**Answer:** Let a demonstrated opportunity trigger a scoped expansion. Reuse the neutral state API, versioned packs/recipes and production separation already justified by Mission Control. A concrete second consumer, sustained voluntary use or a recurring creator need is better evidence than hypothetical market size. Then investigate the next deployment or distribution requirement. Do not shrink the ambition, but do not charge the first soundtrack for an unrequested platform, cloud service or marketplace.

**Disposition:** KEEP expansion possible; DEFER speculative product infrastructure. **Check:** a proposed expansion names a real consumer/problem and which existing boundary actually needs to change. **Owners:** Product goal; Delivery plan.

## Ten strengths worth preserving

1. The recorded/procedural combination lets sound quality and musical variation reinforce each other.
2. The DJ is responsible for the journey rather than blindly shuffling sources.
3. State and musical identity can vary independently.
4. Afterglow and slow release give the soundtrack continuity across work pauses.
5. FL Studio provides an editable authoring workshop without being a listener dependency.
6. A shared musical plan gives recorded and procedural parts a concrete way to cooperate.
7. Offline, model-independent playback avoids making every session depend on inference.
8. Versioned recipes, assets and seeds make useful results reproducible and correctable.
9. Manual control and visible pending/audible state keep the experience understandable.
10. A small external interface leaves room for a larger future without needing to build it first.

These are design strengths, not verified musical outcomes.

## Canonical changes from this review

[Product goal](../PRODUCT_GOAL.md) establishes Mission Control as the first product and keeps later growth open. [First playable](../FIRST_PLAYABLE.md) defines the small audible proof and usable pilot. [Architecture](../ARCHITECTURE.md) makes backend choice evidence-based. [Delivery plan](../DELIVERY_PLAN.md) and [campaign](../campaigns/EMF_INITIAL_INFRASTRUCTURE.md) bring listening and Mission Control forward without removing EMF15/EMF16. [Features](../FEATURES.md), [Capabilities](../CAPABILITIES.md), [Test app](../TEST_APP.md), [Validation](../VALIDATION.md), [Decisions](../DECISIONS.md) and [Current Tasks](../CURRENT_TASKS.md) reflect the same sequence.

The deeper library, state, FL and vocal specifications remain useful design references. The pilot contract deliberately selects only the operations and data it needs; it does not declare those larger documents implemented.

## Primary-source checks

Consulted 2026-11-03; none was executed as an integration test here.

- [S1 — MDN Web Audio scheduling](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Advanced_techniques): supports the browser scheduling investigation, not sound-quality claims.
- [S2 — Chrome Page Lifecycle API](https://developer.chrome.com/docs/web-platform/page-lifecycle-api): motivates lifecycle qualification rather than assuming uninterrupted background operation.
- [S3 — Image-Line Piano roll scripting](https://www.image-line.com/fl-studio-learning/fl-studio-online-manual/html/pianoroll_scripting_api.htm): documents note/marker scripting, not a universal FL remote-control API.
- [S4 — Image-Line commercial-use guidance](https://support.image-line.com/action/knowledgebase?ans=41): distinguishes compositions from restricted sample extraction/distribution; the applicable EULA governs.
- [S5 — Image-Line FL Cloud restrictions](https://support.image-line.com/action/knowledgebase/?ans=720): explicit sample-sharing limitations.
- [S6 — MCP Streamable HTTP specification](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/specification/2026-07-28/basic/transports/streamable-http.mdx): transport-level controls to verify against the chosen protocol version.
- [S7 — Image-Line export documentation](https://www.image-line.com/fl-studio-learning/fl-studio-online-manual/html/fformats_save_export.htm): rendered audio, separated mixer tracks and tail handling support the manual fixture route.
- [S8 — MDN buffer playback rate](https://developer.mozilla.org/en-US/docs/Web/API/AudioBufferSourceNode/playbackRate): resampling is not independent pitch-preserving tempo control.

[S1]: https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Advanced_techniques
[S2]: https://developer.chrome.com/docs/web-platform/page-lifecycle-api
[S3]: https://www.image-line.com/fl-studio-learning/fl-studio-online-manual/html/pianoroll_scripting_api.htm
[S4]: https://support.image-line.com/action/knowledgebase?ans=41
[S5]: https://support.image-line.com/action/knowledgebase/?ans=720
[S6]: https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/specification/2026-07-28/basic/transports/streamable-http.mdx
[S7]: https://www.image-line.com/fl-studio-learning/fl-studio-online-manual/html/fformats_save_export.htm
[S8]: https://developer.mozilla.org/en-US/docs/Web/API/AudioBufferSourceNode/playbackRate
