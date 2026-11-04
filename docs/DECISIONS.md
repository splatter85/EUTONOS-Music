# Design decisions and open questions

Document ID: `EM-D011`  
Status: preliminary, 2026-11-03.

This log records the present design direction and the evidence needed to replace it. Canonical details live in the linked owners.

| ID | Decision or proposal | Reason | Revisit when |
| --- | --- | --- | --- |
| EM-DEC001 | Core accepts external state and also works standalone | Mission Control is a consumer; the music system should be reusable. | A real consumer requires a contract extension. |
| EM-DEC002 | Native local playback is the reference architecture; browser is the control surface | Supports persistent local playback and separates heavy production from UI constraints. | Backend spike shows a browser-only path meets the target more simply. |
| EM-DEC003 | One audio clock and one playback owner | Prevents drift and competing output across tabs/clients. | Never relax without an explicit synchronized multi-output design. |
| EM-DEC004 | Recorded sources and procedural recipes share an arrangement plan | Hybrid continuity requires common tempo, harmony, phrases and role ownership. | Listening shows a simpler constrained handoff can meet a specific case. |
| EM-DEC005 | Model/DAW work runs ahead of playback | Inference and authoring operations are variable-latency and should not gate the next beat. | A bounded real-time technique has measured benefit and failure isolation. |
| EM-DEC006 | Multiple recipes per mood, with variation inside recipes | Mood fit and musical identity are independent axes of variety. | Listening suggests specific family/state mappings need revision. |
| EM-DEC007 | Transition compatibility is directed and revision-specific | A reviewed A-to-B cue does not establish arbitrary or reverse compatibility. | A more general rule is validated against an explicit content class. |
| EM-DEC008 | Three-day endurance and three-day musical breadth are separate goals | Runtime duration and enjoyable variety require different evidence. | Keep the distinction even if one test run supplies both kinds of evidence. |
| EM-DEC009 | Public packs require explicit intended-use provenance | Finished songs, reusable stems, instruments, voice assets and weights have different terms. | A source's current terms or intended distribution changes. |
| EM-DEC010 | Initial work is documentation, not a runtime release | Matches the owner's current requested deliverable. | The owner selects implementation and a stage is assigned. |

## Still open

- Project/code/documentation/content licenses.
- First three musical families and actual reference listening preferences.
- Exact FL Studio build, installed plugin versions and supported control transport.
- Native backend, language/runtime packaging, stretching library and optional browser renderer.
- Default control settings and accepted transition bounds.
- Initial public fixture corpus and source rights evidence.
- Optional first singing/model route, its hardware envelope and permitted output use.
- Numerical resource/timing thresholds for the selected reference environment.

These are scheduled decisions in the campaign, not reasons to block the documentation baseline. Treat the architecture as a reviewable proposal until the corresponding experiments have run.
