# S03 — deterministic DJ and request integration

Document ID: `EM-D021`  
Implemented scope: `EMF-S03`, `campaign-emf-001`. The [campaign](campaigns/EMF_INITIAL_INFRASTRUCTURE.md) owns current status; the [handoff](handoffs/EMF-S03-HANDOFF.md) records exact executed evidence and publication.

S03 connects the local S01 request contract to the S02 Web Audio player. The demo has state, genre, Next, a manual FIFO queue, Hold, cancellation and transport. One deterministic coordinator chooses and schedules; the existing renderer still owns the only audio clock. FL Studio and agents are unnecessary for playback. The original fixture bytes, pack schema and single directed A→B route are unchanged.

## Run and try it

Use Node **24.x** on Windows, macOS or Linux:

```sh
npm ci --ignore-scripts
npm run check
npm run demo
```

Open **http://127.0.0.1:4173/**. Initial state is **Explore**, with no genre restriction. Play chooses recording A by stable ID order. To choose a recording explicitly, queue A or B before Play. Queueing, changing targets or pressing Next while stopped never starts audio.

1. Press **Play**, then **Next Song** before A reaches eight seconds. The DJ schedules the checked four-second A→B overlap. B enters at eight seconds, A finishes the handoff at twelve, and B finishes at about twenty-four seconds, relative to A's start.
2. Before B enters, **Cancel next** removes its future playback and restores all of A, including its original sixteen-second ending. A retained queue entry requires a new Next or Play request before it is scheduled again.
3. Try **Drive** or the `synthetic-test` genre. Both fixtures have these metadata tags; these controls select existing recordings, not a new arrangement or volume change. Browse, Surge and Afterglow have no matching fixture. The requested target remains visible while the current recording finishes naturally.
4. Turn on **Hold state & genre**. Both manual and automated state/genre changes are refused. Queue, Next, cancellation, volume and transport still work. Releasing Hold does not replay rejected requests.
5. Queue A while A is playing, then queue B. A is the FIFO head, and there is no A→A route. B cannot overtake it. Remove that head and press Next to schedule B, or Stop and Play the explicit head from its entry.

Pause freezes the audio clock and keeps committed schedules. Queue/Next while paused never resumes output. Mute gates output while the timeline continues. Stop cancels active/future voices and preparation, while preserving queue entries that have not started. Once a handoff has started, the UI disables Cancel next; the API refuses attempts to undo the mix. Stop and Mute remain immediate.

There is no automatic queue draining, looping or continuous playlist. From B, another Next reports the absent checked route. S04/S05 add procedural material and further handoffs; S03 does not invent a reverse route or a new musical fallback.

## Selection and priority

| Situation | Deterministic policy |
| --- | --- |
| Manual FIFO has an unreserved head | Select that exact entry before automatic candidates. Explicit track choice overrides state/genre preferences, but never availability, playback permission, eligibility or the renderer's checked route. |
| No manual head | Filter supported eligible recordings by requested state and optional genre; exclude the current identity; choose the first valid candidate in stable, case-sensitive ID order. |
| Stopped / naturally ended | Choose a candidate for explicit Play. No native start is inferred from acceptance or queueing. |
| Future compatible plan already exists | Keep its source and exact frame. A newer supported target can rebind the future target without restarting audio; superseded target operations retain that outcome. |
| New target conflicts with a manual reservation | Keep the manual reservation. Show that the target is unmet. |
| No match, blocked head, absent route or missed cue | Explain the reason; preserve current finite playback and the queue. No random substitute, silent FIFO skip, fabricated loop or abrupt replacement. |
| Handoff already started | Finish the committed mix. Retain the new target and require a later Next/Play request; never create a third voice. |

Only the selected route's two recordings are supported by this S03 renderer. Other declared recordings are not silently marked playable. `fixture-only` still requires explicit fixture mode; `unreviewed` media remains ineligible. The owner-local S08 render is not imported or promoted by S03.

## Request API and retry identity

`src/dj.ts` exports `DeterministicDj`, built around one `SmallPlayer` and one already validated `LoadedBrowserPack`. It accepts `em.control.v0` requests through `request()`. `snapshot()` returns the control state, renderer state, pending plan and latest operation. `operation(commandId)` reconciles a previous request. This is a typed, in-process API, not an HTTP endpoint, playback MCP server or untrusted JSON boundary.

The existing `setState`, `requestGenre`, `queueTrack`, `nextSong`, `hold` and `transport` commands remain. Additive S03 commands are:

| Command | Fields / behavior |
| --- | --- |
| `cancelQueue` | `queueCommandId`: remove the exact original queue entry. Cancel its unstarted decode/reservation/native handoff as applicable. An already-started entry has been consumed and cannot be removed as though it were still queued. |
| `cancelNext` | Cancel future selection/preparation without removing the explicit queue entry. Refuse to undo a started transition. No automatic rescheduling follows cancellation. |
| `requestGenre` | `genreId: null` explicitly removes the genre restriction. Unknown and unavailable IDs remain distinct rejection cases. |

Every request still carries caller-known `commandId`, `expectedRevision`, `schemaVersion` and manual/automation source. Cancellation and transport are manual-only. The manual queue is bounded at 32 entries.

The control receipt records acceptance or rejection, never sound. Exact canonical retries recover the original receipt before stale-revision checks. The DJ's separate effect record is claimed before an await; a retry returns its current execution status without creating a second source, enqueue or transport action. Reusing an ID for another body is a conflict. An accepted old Play/Next cannot resurrect audio after Stop or cancellation. A fresh desired effect needs a fresh ID.

Consuming a queue head advances the control revision. A stale new request is refused. The demo may reconcile one rejected **manual transport** request with a fresh revision and new ID so a clock boundary does not defeat a Stop/Pause/Mute click; it never retries an accepted effect or silently overwrites a stale state/genre target.

Receipts and outcomes last for the page/session and survive renderer generation changes within that session. They do not survive reload. Durable retry windows, bounded history retention, reconnect/leases and external adapters remain later work.

## Renderer evidence and cancellation

Requested target, selected candidate, prepared native schedule and clock-confirmed source remain separate. A selected candidate while stopped is not a prepared plan. During a mix, both sources are reported; the incoming source's state is its bound supported target, or `null` when an explicit track does not satisfy that target. These are metadata/renderer facts, not a measurement of mood or the listener's speakers.

The DJ retains initial-start and transition reservation identities before asynchronous work. It reconciles the renderer's frame before effects and teardown, including when promise observation is delayed beyond a start. Queue entries are consumed exactly once when their scheduled entry is observed on the renderer clock, including muted playback. A late UI refresh cannot put a source that already started back in the queue. UI animation reads/reconciles the timeline; it never schedules audio.

Before B's boundary, cancellation releases B, removes A's future exit gain automation and replaces A's scheduled early stop with its original natural end. The source retains its original start envelope and can accept another checked handoff. At or after the boundary, cancellation does not undo the mix. Separate preparation tokens prevent an obsolete asynchronous transition from committing after a later request without invalidating an unrelated initial Play.

## Verification and limits

`npm run check` covers the original pack/media/authoring checks plus deterministic DJ/control/renderer regressions. Tests exercise replay, FIFO blocking and consumption, cancelled preparation, rapid targets, Hold, paused/muted requests, generation changes, exact boundaries and delayed promise observation. Doubles establish calls/state, not native sound.

`npm run check:browser` runs the actual demo in Chromium and retains JSON/screenshots under `artifacts/s03-browser/`. The nine offline checks retain S02's sample comparison and add pre-boundary cancellation at 48 kHz and 44.1 kHz: A is rendered, rendering pauses before B's entry, B is cancelled, A is restored, and every output sample is compared against full-length A. The unchanged maximum absolute sample-error tolerance is `0.000003`.

See the [handoff](handoffs/EMF-S03-HANDOFF.md) for actual results, platform versions, review corrections and remaining uncertainty. Headless Chromium and numerical audio checks do not qualify physical output, human listening, every browser, OS sleep/device loss or the full standalone MVP. Same-origin Web Locks and the hidden-page explicit-resume policy remain as documented in [S02](S02_PLAYER.md#page-and-device-lifecycle).

## Files

| File | Responsibility |
| --- | --- |
| `src/dj.ts` | Deterministic selection, effect reconciliation, reservations, renderer evidence and request integration. |
| `src/control.ts` | Revisioned intent/receipts, FIFO, cancellation acceptance and generation evidence. |
| `src/player.ts`, `src/web-audio.ts` | One-clock playback, native future-handoff cancellation and exact schedule snapshots. |
| `web/app.ts`, `web/index.html`, `web/style.css` | DJ controls, requested/Now/Next/queue visibility and existing tab ownership. |
| `tests/dj*.test.ts`, `tests/control.test.ts`, player/source tests | Deterministic contract, boundary and race checks. |
| `web/checks.ts`, `scripts/browser-check.ts` | Native offline samples and real demo behavior. |
