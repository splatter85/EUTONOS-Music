# S04 — original-palette procedural sampler

Document ID: `EM-D022`  
Scope: one finite seeded sampler/phrase source and its audition path. The [campaign](campaigns/EMF_INITIAL_INFRASTRUCTURE.md) owns current delivery status; the [handoff](handoffs/EMF-S04-HANDOFF.md) records source-pinned execution evidence and limits.

**EMF-S04 — CLOUD is COMPLETE and integrated into main.** Corrected source `73c456a147dcf24161ce22187e5e62320c5141b5` passed Node/native/browser checks on Windows, macOS and Linux; the [S04 handoff](handoffs/EMF-S04-HANDOFF.md) retains original source and publication evidence. S05 and S06 are also in main. [S07](S07_APP.md) adds linked demo surfaces and imported mock-palette playback. Physical output and human listening are NOT TESTED.

## Try a variation

Use **Node 24 or newer** on Windows, macOS or Linux:

```sh
npm ci --ignore-scripts
npm run check
npm run demo
```

Open **http://127.0.0.1:4173/procedural.html**. Choose seed **1**, leave **Explore** selected, and press **Play variation**. The eight-bar performance lasts sixteen seconds after its scheduled entry. Press Stop, try seed **2**, and compare the phrase pattern. Try the same seed with **Drive** for its fuller percussion/harmony arrangement. An unsigned 32-bit whole number from **0** through **4294967295** is accepted; there is no implicit random seed.

Pause suspends the existing audio clock; Resume preserves its note schedule. Mute changes the master output while the clock continues. Stop cancels every remaining note. Hiding the page pauses it until an explicit Resume, and reloading starts silent. The recording DJ and sampler pages use the same cooperating-tab Web Lock. Stop in the owning tab before playing in another tab on the same origin. This is browser-partition coordination, not a device-wide lock.

The seed and arrangement controls are disabled during preparation, scheduled playback, playback and pause. Requested selection, actual clock-active performance and clock diagnostics are shown separately. An invalid seed cannot start a performance. Natural completion releases ownership; replay is explicit.

This page is a bounded source audition. The [recording DJ](S03_DJ.md) has two S01 recordings and one A→B route, with the [S05](S05_HYBRID.md) procedural bridge. [S06](S06_IMPORT.md) generalized the performer palette contract; [S07](S07_APP.md) exposes original/imported palette comparison in this sampler. Generalizing the DJ/hybrid for imported recordings remains S09.

## Musical boundary and replay identity

`src/phrase-plan.ts` implements one versioned, compiled performer, `s04-s01-performer@1`, over the unchanged **s01-foundation@1** pack, **s01-recipe@1** descriptor and **s01-palette@1**. The pack schema remains `em.audio-pack.v0`. Recipe metadata is data, not executable code or an uploaded script. Since [S06](S06_IMPORT.md) the same performer also plays any palette that meets `s06-performer-palette@1`; every S01 plan is unchanged.

The original [S01 palette](../fixtures/s01/PROVENANCE.md) supplies a kick, seeded percussion, A2 bass and A-minor harmony. Every sample retains its original pitch and full bounded one-shot duration. There is no pitch shifting, time stretching, synth/plugin execution, model call, network production job or FL dependency in playback.

The performer uses 120 quarter notes per minute, 4/4, eight bars and constant A-minor harmony. A four-bar statement is followed by a four-bar answer with different rhythm/motif choices and designated phrase-ending fills. Explore leaves more space; Drive adds bounded rhythmic and harmonic activity. These names describe authored arrangement choices, not measured listener responses or productivity effects.

The immutable plan retains performer, pack, recipe and palette IDs/revisions, the seed and state, complete sample metadata/hashes, section choices and the ordered event list. Independent deterministic streams for drums, bass, percussion and harmony keep a new choice in one role from consuming another role's random sequence. The same inputs reproduce the same symbolic plan. Selected different seeds change event positions and phrase choices, not only an identifier or velocity noise. Many seeds can still map to the same small authored choice set; seed count is not a count of unique compositions.

Only plans returned by `compileS01Phrase` in the current module instance can be passed to the source. Arbitrary or JSON-rehydrated event arrays are refused. To replay a saved identity, load the exact eligible pack and recompile its recorded seed/state with the matching performer version. Importing arbitrary plan JSON is not an S04 capability. Hashes detect changed bytes; they do not establish musical taste or erase historical evidence.

## Shared source and transport

`ProceduralSource` implements the same `PlayableSource` lifecycle as `RecordedSource`:

1. Compile the finite plan and decode its four samples outside the scheduling deadline.
2. `prepare(clock)` retains the caller's `WebAudioClock` by identity and validates the context, source metadata, permissions, decoded format and resource bounds.
3. `scheduleStart({at, entryCueId: 'entry'})` commits every note at an absolute frame on that clock. No JavaScript timer, animation frame or note-ended callback starts later notes.
4. `stop(at)` gates output and stops current/future notes at the requested frame, or `transitionOut(cueId, at)` follows one declared phrase exit and the caller's bounded fade.
5. `release()` cancels future starts and disconnects all retained nodes. Cleanup is idempotent and remains legal after generation invalidation.

The only entry is quarter zero. Exits are **`phrase` at quarter 16 / eight seconds** and **`end` at quarter 32 / sixteen seconds**, expressed relative to the source timeline origin and converted into output-clock frames. `fadeInFrames` and `fadeOutFrames` are construction-time options in output-clock frames. A nonzero end fade would exceed this finite performance and is refused. A phrase fade must fit inside the remaining duration and follow a completed entry fade. Invalid or missed cues are refused before effects. The concrete source's `cancelTransition()` extension, which is not part of `PlayableSource`, can cancel a future exit before its onset, restoring the original envelope and each note's natural deadline; after onset it cannot be undone.

Frames come from the same native context used by the recording player. Sample boundaries are rounded on that timeline. A native decoder may report a one-frame EOF difference; the sampler bounds each note by its declared end and actual decoded length, so padding cannot extend the phrase or create an extra same-role overlap. The source also checks that rounded output-frame intervals contain at most one active note per role. Decoder rounding is reported separately from cue placement and sample-comparison tolerances.

`SmallPlayer.playProcedural(plan, ownership)` reuses the existing output gain, clock, context, transport states and operation epochs. A stopped or replaced decode cannot later schedule notes. Pause/resume does not allocate a second performance, and a denied ownership gate stays silent. The S03 DJ itself is unchanged; its A→B planner remains limited to recordings.

For S05 pickup, `playProcedural` is a **replacement/audition operation**: it releases existing voices and invalidates their generation. It cannot itself schedule an overlapping incoming source. `transitionOut` fades the complete precommitted performance, including any new note attacks inside the fade window; it is not a tails-only exit or independent bass/role transfer. S05 must define and check those musical handoff policies before admitting a new route. The source's `reference` names the recipe revision; retain its full `plan` to identify the actual seed/state/performance.

The player shares one pending or resolved four-sample decode across all seeds/states. Repeated Play/Stop cannot multiply preparation jobs. Stop retains this bounded verified palette for replay; disposal releases the player's cache references. Every new intent rechecks its plan, pack and current permissions before reuse. A different complete sample-metadata binding requires a reload rather than silently replacing the palette beneath an existing player.

### Minimal API example

In a browser TypeScript module under `web/`:

```ts
import {loadBrowserPack, compileS01Phrase, SmallPlayer} from '../src/index.js';

const loaded = await loadBrowserPack(new URL('/fixtures/s01/manifest.json', location.href), true);
const plan = compileS01Phrase(loaded.pack, {seed: 1, state: 'explore', allowFixtures: true});
// Call from an explicit user gesture; the app supplies its Web Lock ownership promise.
async function startSelected(ownershipPromise: Promise<void>): Promise<SmallPlayer> {
  const player = new SmallPlayer(new AudioContext(), loaded, 's01-a-to-b');
  await player.playProcedural(plan, ownershipPromise);
  return player;
}
```

`true` is an explicit opt-in to **fixture-only** audio; it is not listening approval. The source checks both playback and **sample-reuse** rights for every sample. Decoding rechecks the copied sample bytes against their bound SHA-256 before passing them to the native decoder. Source construction with already decoded buffers is an in-process seam: the caller must supply the actual verified buffers rather than relabel arbitrary audio.

## Resource limits and failure behavior

| Resource | Enforced boundary |
| --- | --- |
| Plan | One eight-bar, sixteen-second performance; no loop or automatic continuation |
| Events | At most 256 native note sources for one performance |
| Polyphony | At most four concurrently sounding note intervals, including sample tails; at most one per role after output-frame rounding |
| Mix buses | Two fixed unity-gain `GainNode` buses: drum + percussion and bass + harmony |
| Decoded sample residency | At most 1,048,576 Float32 sample values / 4 MiB for the four samples |
| Native scheduling | Entire finite schedule committed before the requested entry; a partial or late failure stays gated and releases all nodes |
| Replay state | Seed/state and immutable plan for the current session; no persistent listening history |

The event-node cap counts all scheduled future notes, not just currently sounding notes. The two mix buses are additional fixed nodes alongside the per-note gains and source envelope; they fix the grouping of sample sums for replay. Both buses disconnect after failure, release or natural completion. Each completed note disconnects; explicit release drops the source's buffer references. The original pack loader separately retains verified compressed/file bytes under its existing 16 MiB demo cap. These are enforced allocation/interval bounds, not measured process RSS, underrun or long-session performance qualifications.

The source accepts integer context rates from 8 to 192 kHz; native checks passed at **44.1 and 48 kHz** on Windows, macOS and Linux for the corrected source. Other sample rates, browsers, real devices and longer-running environments require their own evidence. No exact cross-browser or cross-platform audio-byte identity is assumed from symbolic determinism.

## Verification surfaces and limits

`npm run check` passed 130 tests locally for the corrected S04 source, including phrase replay/constraint, bounded mixing and source/transport lifecycle regressions; independent review also passed 18 focused tests. Context/source doubles do not render audio. The original 127-test result remains historical evidence for the earlier source checkpoint.

**[CI run 41961109555](https://github.com/splatter85/EUTONOS-Music/actions/runs/41961109555) passed 130 Node tests, all 15 native offline checks and all 11 browser report groups on Windows, macOS and Linux.** The browser report comprises the native-check summary and ten UI groups, including the original DJ flow and sampler page. The run used Chromium **151.0.7922.34** and Playwright **1.62.1**, with Node **24.22.1** on Linux and **24.22.2** on macOS/Windows.

The original [three-platform native run](https://github.com/splatter85/EUTONOS-Music/actions/runs/41959790896) failed strict replay; the [handoff](handoffs/EMF-S04-HANDOFF.md) records diagnosis and the corrected summing groups. The corrected source passed the strict zero-error replay gate at both 44.1 and 48 kHz. The independent sample-comparison tolerance remains `0.000003`. Native checks independently sum decoded samples at expected frames and exercise replay/variation and stop/exit/release behavior; `npm run check:browser` exercises the DJ and sampler pages in Chromium. See the handoff for exact source-pinned reports and retained artifacts.

**Physical speaker/headphone output and human listening are NOT TESTED and remain separate acceptance work.** A nonzero, unclipped and repeatable render does not establish that the music is enjoyable, that every seed is coherent, or that transitions to recordings sound good. S05 joins the sources; S09 joins real FL material; S10 supplies owner listening acceptance. The whole standalone MVP and campaign remain open.
