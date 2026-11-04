# State and external control contract

Document ID: `EM-D006`  
Status: illustrative API design, 2026-11-03. No endpoint or MCP tool in this document exists yet.

**Executable subset:** [S01 foundation](S01_FOUNDATION.md) and `src/control.ts` define the versioned local request contract. [S03 DJ](S03_DJ.md) connects it to the S02 renderer with deterministic selection, queue priority, Hold, cancellation, effect reconciliation and clock-confirmed source state. This is an in-process API; the HTTP/playback-MCP endpoints, durable receipts, expiry and lease behavior below remain proposals.

## Intent and audible reality

External clients request a musical target. The director decides a valid route and the audio engine reports what is actually playing. Keep three views distinct:

1. **Requested state:** the latest accepted intent under the control policy.
2. **Prepared plan:** a transition/arrangement that can execute at a known future boundary.
3. **Audible state:** the engine-confirmed source, musical position, mixture and control values.

The user interface must display a pending transition instead of labeling the soundtrack as already changed. Intent acceptance is not transition completion.

## Named states and continuous dimensions

Browse, Explore, Drive, Surge and Afterglow are initial convenience profiles. A profile maps to bounded preferences, not one fixed song or an inferred mental state. Profile definitions are versioned and editable after listening trials.

| Control | Meaning | It should not imply |
| --- | --- | --- |
| Energy | Overall rhythmic/arrangement drive | Louder output or automatically faster BPM |
| Density | How many parts/events compete for attention | Higher musical quality |
| Brightness | Tonal brightness and openness of the sound | Positive mood or increased energy in every genre |
| Tension | How unresolved or insistent the musical development feels | Uncontrolled dissonance |
| Atmosphere | Space, sustained texture and ambient detail | A mandatory reduction in groove |
| Variation | How often/how much approved musical material develops | Replacement of the theme on every bar |
| Tempo preference | Desired range or movement within reviewed bounds | Pitch-shifting an audio buffer by accident |

Use normalized internal values where useful, but give the interface meaningful labels and ranges. Values are control settings, not measured human emotion. A recipe declares which dimensions it supports and maps them musically; unsupported controls are reported rather than silently faked.

## Transition controls

- **Transition length:** desired musical duration, such as a range of bars. Show a time estimate at the active tempo/meter.
- **Minimum stay:** time or completed sections from the actual audible entry into a musical identity before another large identity change is considered. Pending-request time does not satisfy this dwell period; explicit transport/mute still takes precedence.
- **Musical contrast:** preferred difference between current and next identity, subject to compatibility.
- **Maximum tempo movement:** a hard bound or approved range, expressed in BPM/ratio with pitch-preservation policy.
- **Change pace:** how fast permitted continuous automation can move.
- **Vocal activity:** no vocals, occasional phrases, or vocal-led selections, limited by available reviewed material.
- **Source preference:** recorded, procedural, or mixed; the engine exposes when the requested source is unavailable.

Contrast is a selection budget over rhythm, harmony, timbre, density and tempo. It is not a guarantee that any two sources can be joined. The UI can start with gentle/moderate/bold labels while diagnostic views expose the underlying dimensions.

## Command shape

The examples are contract sketches. Final validation schemas and compatibility rules belong to EMF04/EMF07/EMF14.

```json
{
  "schema_version": "em.intent.v0",
  "command_id": "demo-command-001",
  "session_id": "demo-session",
  "expected_revision": 12,
  "source_id": "manual-test-app",
  "target": {
    "profile": "drive",
    "energy": 0.65,
    "atmosphere": 0.4,
    "variation": 0.35
  },
  "transition": {
    "preferred_bars": 16,
    "max_tempo_delta_bpm": 3,
    "contrast": "moderate",
    "boundary": "phrase"
  },
  "minimum_stay_seconds": 60,
  "expires_after_seconds": 180
}
```

These values are fictional examples, not calibrated defaults. `expires_after_seconds` limits how long a pending intent may wait before starting. It is measured from server receipt using a monotonic duration; it is separate from a client's control lease. Expiry before a transition starts marks the pending intent expired and preserves the active music. Once a transition starts, its expiry does not cut a phrase or stop playback; safe completion/cancellation rules apply. Clients do not schedule audio by their wall clocks.

An acknowledgment includes command ID, accepted target revision, engine generation, validation result, and pending status. The original command ID is also the operation lookup key, so a caller can reconcile a timeout without having received an acknowledgment. Once a plan exists, return its ID, source/target, expected boundary, transformation summary and fallback. Events then report scheduled, started, completed, superseded, cancelled, expired, rejected or failed, with an explicit reason.

## Proposed endpoints

| Endpoint | Responsibility |
| --- | --- |
| `GET /v0/capabilities` | Report actual backend, available controls, source kinds and adapter readiness. |
| `POST /v0/sessions` | Create a playback session in a stopped state. |
| `GET /v0/sessions/{id}` | Return requested, planned and audible state with revisions. |
| `POST /v0/sessions/{id}/intents` | Validate and record an idempotent target request. |
| `POST /v0/sessions/{id}/transport` | Explicit play, pause, stop, mute and resume operations. |
| `POST /v0/sessions/{id}/hold` | Hold selected aspects of the current music and return the exact hold policy. |
| `GET /v0/sessions/{id}/events` | Stream ordered state/plan/outcome events with reconnect support. |
| `GET /v0/library` | Search eligible assets/recipes with filters and review scope. |
| `POST /v0/auditions` | Prepare a bounded source/transition comparison; do not start sound without an explicit play operation. |
| `GET /v0/operations/{command_id}` | Reconcile a command outcome using the identity supplied in the original request. Production jobs follow the same caller-known identity rule in their namespace. |

Production jobs use a separate namespace and permission scope. A playback caller cannot use these endpoints to edit an FL project or read arbitrary local files.

## Proposed playback MCP tools

| Tool name | Intended effect |
| --- | --- |
| `music_get_capabilities` | Read supported controls and current adapter readiness. |
| `music_get_state` | Read requested/planned/audible state. |
| `music_set_state` | Submit a revisioned intent, returning a command receipt. |
| `music_hold` | Hold the current scene, recipe or selected dimensions. |
| `music_transport` | Explicit transport and mute operations. |
| `music_search_library` | Find eligible musical material and its constraints. |
| `music_prepare_audition` | Prepare a bounded comparison for explicit playback. |
| `music_get_operation` | Retrieve outcome evidence using the original caller-supplied command ID. |

These names are proposals. Discover actual tools at runtime once a server exists. The FL authoring tools are specified separately in [FL Studio integration](FL_STUDIO_INTEGRATION.md).

## Ownership, ordering and duplicate handling

A session has one control policy and one playback owner. The first backend allows one audible session per output device, including auditions. Creating a stopped session does not acquire the device. Playing requires ownership, an explicit transfer, or a conflict response. Manual transport/mute and an explicit owner hold outrank automatic consumer requests. Other clients receive named priorities or a control lease; they cannot gain authority by sending requests more often.

For the same command ID and identical canonical payload, return the original receipt. Perform duplicate lookup before evaluating stale revisions or expiry, so a successful request can recover its receipt after the state has moved on. Reusing an ID with different content is a conflict. A new request with an out-of-date expected revision is a conflict with the current state, not a silent overwrite. After a timeout, query by the original command ID or replay the identical request with that ID before considering a new operation.

Within one automatic source, coalesce pending targets so a burst of changes does not become a backlog of obsolete transitions. Preserve started transitions through their safe completion/cancellation points. An immediate mute can always reduce output; an abrupt request for a completely different song may need to wait or use an explicit emergency fade.

The engine has its own generation number, changed on restart. Scheduled messages from an old generation cannot execute in the new one. Persist receipts long enough for the configured retry window, then document retention and expiration.

## Hold semantics

Offer distinct behaviors instead of an ambiguous freeze switch:

- **Hold state:** maintain the current energy/texture target while selection and development continue.
- **Hold recipe:** keep the musical identity, with permitted internal variation.
- **Hold moment:** preserve a bounded arrangement/parameter setup; explain whether the loop/section repeats.

Each hold records what remains free to change and whether it expires. Release returns control to the active source policy and plans a new transition rather than jumping directly to stale intent.

## Adapter isolation

The first test client supplies explicit state. Later adapters may translate work activity, game events or another application's controls into intent. They own interpretation, smoothing and their own data handling. The core engine owns musical dwell and transition behavior even if a client sends noisy signals.

No application content or typing text is required for the core state API. Activity-derived adapters should send only the information needed to express a musical target. A hidden or disconnected browser is not proof that the listener stopped working.

## Local access and persistence

Bind the local service to loopback by default, validate origins, use explicit session credentials for writes, and restrict local-file paths to registered library/project roots. Credentials remain outside the repository. If remote control is later enabled, it is a separate deployment capability with an explicit access model.

For MCP transports, use the maintained specification for the selected protocol version; current Streamable HTTP guidance includes origin validation, local binding and authentication requirements. [C1] Do not expose an unauthenticated all-interface service because it is convenient for the first demo.

## Required contract scenarios

The implementation campaign must demonstrate duplicate retry, stale revision, rapid alternating state requests, a late plan, a missing asset, hold/release, reconnect, engine restart, output-device loss, and a caller disconnecting during a transition. Verify audible behavior where it matters; API response snapshots alone are insufficient.

## Source

- [C1 — MCP Streamable HTTP transport](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/specification/2026-07-28/basic/transports/streamable-http.mdx), reviewed 2026-11-03.

All endpoint shapes and policies above are original proposals for this project.

[C1]: https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/specification/2026-07-28/basic/transports/streamable-http.mdx
