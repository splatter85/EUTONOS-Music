# S20 — Studio set decks

Status: decks built on `work/emf-s20-decks`, with the set analysis/cache follow-up on dependent `work/emf-s20-set-analysis`; see the [source-pinned handoff](handoffs/EMF-S20-HANDOFF.md) for actual verification and delivery state. The [campaign](campaigns/EMF_INITIAL_INFRASTRUCTURE.md) owns current status. This extends [S18 set mode](S18_SET_MODE.md) and [S19 transitions](S19_TRANSITIONS.md).

## Owner controls

Open `/studio.html?pack=set`. Physical Deck A and Deck B alternate songs. Each deck has a live output waveform, Low/Mid/High EQ, one filter control, elapsed/remaining time, grid BPM and tempo/pitch information. The deck waveform is a live signal scope. The set list also has a full-song overview after the song is decoded for playback or analyzed.

The DJ owns every control initially. Drag a knob vertically or horizontally, or focus it and use the arrow keys. EQ ranges from -24 to +6 dB; the filter moves from low-pass through open to high-pass. Moving a control makes it **You**. Its **Return to DJ** button hands back that control alone. The crossfader has its own ownership and return button. A 20 ms audio-clock slew avoids instantaneous manual gain/filter changes.

Manual ownership stays with the physical deck across Next, Auto, queue reorder, cancellation, pause/resume and Stop/Play. It lasts for the current player session, until explicit handback or disposal/reloading the pack. A new song arriving on that deck inherits its manual settings. Handback joins the automatic curve at the current audio time, including its remaining future trajectory.

Next and Auto continue to start and end sources at planned boundaries. Moving the crossfader does not load a song or prolong a stopped/ended source. Hold, Stop, mute, the master level and phone controls retain their existing meanings. A manual crossfader position can intentionally leave the newly playing deck quiet; return it to the DJ to resume automatic level handling.

## One playback owner

`SmallPlayer` owns the existing context, clock, sources, master output and stream-to-phone tap. Each set source feeds one persistent deck bus: Low/Mid/High EQ, high-pass/low-pass pair, recipe/manual fader, and a separate source-lifetime gate. The optional analyser is an observational tap. Display refresh reads the owner's audio time and never schedules music.

Recipe gain, low shelf and filter automation are delegated to these same lanes. Manual control therefore replaces that lane's automation. The lifetime gate remains independent, so a manually open fader cannot expose a prepared future source or filter tails after its end. Per-voice leases and per-schedule identities prevent retired handles from clearing a newer song or automation. Failed multi-lane scheduling restores the previous automatic plans.

The set chooser and entry-point rules are unchanged. Echo retains its original send/return graph on the existing authored-pair path; the set chooser does not offer echo. The common deck graph also processes both branches of the finite loop's first 20 ms splice; this is a signal-path change, not a different loop or recipe choice, and has not been listening-qualified.

## Reading the display

Requested grids remain labelled requested. Measured grids remain labelled measured. The position and tempo readouts follow the committed processed mapping, native-rate ramp, finite loop or native continuation. Preserved or independently shifted pitch is distinguished from rate-linked pitch for native tempo ramp/brake. These are source-derived engineering readouts, not proof of perceived musical quality.

## Set analysis and song overviews

The `work/emf-s20-set-analysis` follow-up adds measured BPM and key estimates to each song row. Requested BPM stays separately labelled. Uncertain rhythm or key stays uncertain; an alternative key candidate is never presented as a measured answer. The row shows the analyzed interval because the existing analyzer measures a bounded window (up to 60 seconds), not necessarily the whole song.

Mix preparation fills these rows as needed. **Analyze** is also available while stopped or paused; it uses the existing native-song preparation path and does not start playback or alter the queue. The overview scans all native frames and both channels, retaining 512 absolute peak bins, including stereo antiphase material. Its playhead reads the existing deck clock. A dedicated browser worker receives at most one private PCM chunk at a time, with at most one running and one queued song. Native playback buffers are never transferred.

Successful analysis and available waveform summaries are stored in a separate, disposable IndexedDB database. No audio is stored there. The key preserves the canonical SHA-256, analysis version, level version, decoded sample rate, analysis-window policy/length/start and requested BPM hint. Reloading the same origin restores small display records without fetching WAV files. Actual analysis reuse also checks the decoded buffer's exact frame/channel dimensions.

The cache validates versioned evidence, full-song coordinates, array bounds, native peak coverage, waveform dimensions and a payload checksum. Display restoration allows the same one-frame resampling rounding as the decoder; planner reuse remains exact. Invalid or stale records are discarded and the unchanged analyzer runs again. A blocked database, quota failure or unavailable storage leaves the session analysis path working. Persistence writes and waveform scans are not awaited by playback.

Storage is bounded to 64 records, one MiB per payload and a conservative 16 MiB total budget, evicting the least recently used records. The in-session front cache and canonical cache are each bounded to 64 entries. Deadlines bound storage and display work only; they never schedule music. Saved waveform objects are immutable. The saved results remain engineering estimates, not listening judgments or new transition-selection rules.

## Verification and limits

The handoff records each branch's exact Windows Node and browser checks, independent review and native offline sample comparisons. No real phone, owner songs, physical output, touch hardware, macOS, Linux or listening is qualified by these slices. The live evaluator pre-check is the next assigned slice. No stems or transition selection changes are included.
