# S05 — recording → procedural bridge → recording

Document ID: `EM-D023`  
Scope: one checked hybrid handoff policy and the DJ path that uses it. The [campaign](campaigns/EMF_INITIAL_INFRASTRUCTURE.md) owns delivery status; the [handoff](handoffs/EMF-S05-HANDOFF.md) records source-pinned evidence and limits.

**EMF-S05 is COMPLETE** for its bounded engineering scope. It was built on the owner's Windows PC (the slice table labels S05 CLOUD; the owner chose to build it here) and integrated into main. Checks ran on **Windows only**; macOS and Linux were not run. **Physical output and human listening are NOT TESTED.** Every timing and fade below is an engineering choice that nobody has listened to yet.

## Try it

Use Node 24 or newer on Windows, macOS or Linux:

```sh
npm ci --ignore-scripts
npm run check
npm run demo
```

Open **http://127.0.0.1:4173/**. Set **Handoff** to **Procedural bridge A → bridge → B**, press **Play**, then **Next Song**. The page shows the scheduled bridge seed and state, then each phase as the audio clock reaches it:

| Time after A starts | What is scheduled to sound | Page status |
| --- | --- | --- |
| 0 s | Recording A | Playing |
| 8 s (A's exit cue) | A fades out over one bar; the bridge enters with **percussion only** | Bridge entering — A fades for one bar |
| 10 s | A is silent; the bridge adds drums, bass and harmony | Procedural bridge playing |
| 16 s (bridge phrase exit) | B enters at full level; only bridge percussion continues, fading over one bar | B entered — bridge percussion fades |
| 18 s | B alone | Handoff complete |
| 32 s | B ends | Playback ended |

The handoff choice applies to the next selection; a scheduled transition keeps its kind. **Crossfade** remains the default and behaves exactly as in [S03](S03_DJ.md). Cancel next works until the bridge enters at 8 s and restores the whole of A; after that the handoff finishes. Stop stays immediate at any point and keeps a queued B for the next Play. Pause, Mute, Stop, Hold, the manual queue and the cooperating-tab lock behave as before.

## The policy

`src/hybrid-handoff.ts` defines one code-versioned policy, **`s05-hybrid-handoff@1`**:

| Field | Value |
| --- | --- |
| Route | `s01-a-to-b@1` (the pack's one directed route; its cues are reused) |
| Bridge performer / recipe | `s04-s01-performer@1` over `s01-recipe@1` |
| Lead-in | one bar (4 quarters); only `percussion` may play while A fades |
| Tail | at most one bar; only `percussion` may continue under B, fading to silence |
| Bridge exit | `phrase` (quarter 16, default) or `end` (quarter 32, no tail) |
| Review | `engineering-only` |

A different route, performer, recipe or timing needs a new policy revision. The policy is code, not pack data: the `em.audio-pack.v0` schema, the six original WAVs and the S04 performer are unchanged.

**Why this shape.** Two bass lines must never sound together, and S04's fade covered the whole performance. So the bass changes owner only when the outgoing source is silent: A is gone before the bridge bass starts, and the bridge's last bass note ends before B enters. The only overlaps are A with bridge percussion (one bar) and bridge percussion with B (one bar). That also keeps at most two nonzero sources summed at any frame, which preserves exact same-seed native replay in Chromium.

## How it is checked and scheduled

`planHybridHandoff()` refuses before any audio effect unless:

- the route is the one the policy covers, and the bridge plan is the policy performer and recipe for this pack revision;
- A, B and the bridge share one tempo, a 4/4 meter, one key and the recipe's harmony;
- both route cues sit on bar lines and A has a complete bar after its exit cue;
- the bridge exit is declared and comes at least one bar after the lead-in;
- A's exit cue is still at least the player's scheduling lead in the future.

It returns every boundary as an absolute frame on the one clock: `fromExit`, `bridgeFull`, `toStart` and `end`. `SmallPlayer.scheduleHybrid(plan, exit)` checks once, decodes (sharing the S04 palette cache), prepares the bridge and B, **checks again**, and commits with `commitHybridHandoff()`. A late commit is refused, never moved to a later boundary. The commit changes A last, so a refusal leaves A playing unchanged; the player then releases the prepared bridge and B.

Two narrow source extensions make the role rules exact rather than approximate:

- `ProceduralSource` accepts a `leadIn` window. Notes outside its roles inside the window are never allocated.
- `ProceduralSource.transitionOut(exit, at, retain)` cancels every non-retained attack at or after the exit (stop at its own start frame, so it produces no sample), lets retained roles sound only inside the window under the output fade, and refuses before any effect if a non-retained note would still sound at the exit. `RecordedSource.transitionOut` accepts a one-off fade length for A's tail bar.

Without these options both sources behave exactly as in S04.

### The DJ

`new DeterministicDj(player, loaded, 'explore', {handoff: 'hybrid', bridgeExit: 'phrase'})` or `setHandoff('hybrid')` selects the bridge. Selection, the FIFO queue, Hold, retries and cancellation are the S03 rules; only the scheduling call differs.

- **Seed:** `bridgeSeed(commandId)` (FNV-1a, uint32). A recorded command ID replays the same bridge.
- **State:** the bridge plays `drive` when Drive is requested and `explore` otherwise, because the S04 performer has only those two. When the requested state is neither, the bridge is reported with state `null`, so the DJ never claims a request it does not serve. If the request changes before the bridge enters and the scheduled bridge no longer matches it, the bridge is rescheduled under the new command's seed.
- **Reports:** `player.handoff` carries the policy, bridge identity (recipe, performer, seed, state, exit), the four boundaries and a phase from the audio clock: `scheduled`, `lead-in`, `bridge`, `tail`, `complete`. The control snapshot's audible sources list A, the bridge and B as the clock reaches them. B is planned and reported `started` at its own entry (the bridge exit), and a queued B leaves the queue then, as in S03.
- **Commitment:** once the bridge enters, the request stays `scheduled` with the reason that the bridge has entered. Cancel next, Next and removing B from the queue are refused (a refused removal still drops the listing, as S03's control model does). Stop stays immediate and keeps an unstarted queued B.

These phases are computed from the audio clock. They are not measurements of device output.

### Minimal API example

```ts
import {compileS01Phrase, loadBrowserPack, SmallPlayer} from '../src/index.js';

const loaded = await loadBrowserPack(new URL('/fixtures/s01/manifest.json', location.href), true);
const player = new SmallPlayer(new AudioContext(), loaded, 's01-a-to-b');
await player.play('a');                       // from a user gesture
const bridge = compileS01Phrase(loaded.pack, {seed: 7, state: 'explore', allowFixtures: true});
await player.scheduleHybrid(bridge);          // A → bridge → B, committed before A's exit
console.log(player.snapshot().handoff);       // policy, seed/state, boundaries, phase
```

## Limits

- One route (A → B), one performer and the S01 fixtures. There is no B → A, no chain of bridges and no automatic continuation after B.
- The S04 performer has no vocals; vocal ownership is untested. Tempo, key or meter changes between recordings are refused, not bridged.
- The bridge always starts on A's route exit cue. The page uses the `phrase` exit; `end` is available through `DjOptions` and the API.
- Timing, fade lengths and which roles overlap are engineering choices. Whether the result sounds good is unknown until someone listens (S10).
- Verified on Windows only, under Node 26.12.1. Native checks ran at 44.1 and 48 kHz in Chromium 151. macOS, Linux, other browsers, real audio devices and long sessions are not verified.

## Verification

All on the owner's Windows PC; see the [handoff](handoffs/EMF-S05-HANDOFF.md) for exact numbers.

- `npm run check`: 143 Node tests (13 new S05 tests), unchanged fixture and media checks.
- `npm run check:browser`: 19 native offline groups (4 new) and 12 browser report groups (1 new live bridge stage) in headless Chromium.
- The native groups render A, the bridge and B on three separate channels and compare each sample with an independent oracle that does not import the planner's frame or envelope helpers. They confirm the bass stays between A's silence and B's entry, only percussion overlaps a recording, at most two sources sound at once, the summed mix stays below full scale, same-seed replay is bitwise identical, the `end` exit leaves no tail and stays below full scale, and cancelling before the bridge restores A exactly. They build the handoff from the planner and sources directly; `SmallPlayer.scheduleHybrid()` itself is covered by the Node tests and the live browser stage.
- An independent read-only review and its corrections are recorded in [the S05 review](reviews/EMF_S05_HYBRID_REVIEW.md).

**Rendered: yes (offline). Played on physical output: no. Auditioned by a listener: no.**
