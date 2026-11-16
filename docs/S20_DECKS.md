# S20 — Studio set decks

Status: built on `work/emf-s20-decks`; see the [source-pinned handoff](handoffs/EMF-S20-HANDOFF.md) for actual verification and delivery state. The [campaign](campaigns/EMF_INITIAL_INFRASTRUCTURE.md) owns current status. This extends [S18 set mode](S18_SET_MODE.md) and [S19 transitions](S19_TRANSITIONS.md).

## Owner controls

Open `/studio.html?pack=set`. Physical Deck A and Deck B alternate songs. Each deck has a live output waveform, Low/Mid/High EQ, one filter control, elapsed/remaining time, grid BPM and tempo/pitch information. The waveform is a live signal scope; song overview waveforms belong to the following display/cache slice.

The DJ owns every control initially. Drag a knob vertically or horizontally, or focus it and use the arrow keys. EQ ranges from -24 to +6 dB; the filter moves from low-pass through open to high-pass. Moving a control makes it **You**. Its **Return to DJ** button hands back that control alone. The crossfader has its own ownership and return button. A 20 ms audio-clock slew avoids instantaneous manual gain/filter changes.

Manual ownership stays with the physical deck across Next, Auto, queue reorder, cancellation, pause/resume and Stop/Play. It lasts for the current player session, until explicit handback or disposal/reloading the pack. A new song arriving on that deck inherits its manual settings. Handback joins the automatic curve at the current audio time, including its remaining future trajectory.

Next and Auto continue to start and end sources at planned boundaries. Moving the crossfader does not load a song or prolong a stopped/ended source. Hold, Stop, mute, the master level and phone controls retain their existing meanings. A manual crossfader position can intentionally leave the newly playing deck quiet; return it to the DJ to resume automatic level handling.

## One playback owner

`SmallPlayer` owns the existing context, clock, sources, master output and stream-to-phone tap. Each set source feeds one persistent deck bus: Low/Mid/High EQ, high-pass/low-pass pair, recipe/manual fader, and a separate source-lifetime gate. The optional analyser is an observational tap. Display refresh reads the owner's audio time and never schedules music.

Recipe gain, low shelf and filter automation are delegated to these same lanes. Manual control therefore replaces that lane's automation. The lifetime gate remains independent, so a manually open fader cannot expose a prepared future source or filter tails after its end. Per-voice leases and per-schedule identities prevent retired handles from clearing a newer song or automation. Failed multi-lane scheduling restores the previous automatic plans.

The set chooser and entry-point rules are unchanged. Echo retains its original send/return graph on the existing authored-pair path; the set chooser does not offer echo. The common deck graph also processes both branches of the finite loop's first 20 ms splice; this is a signal-path change, not a different loop or recipe choice, and has not been listening-qualified.

## Reading the display

Requested grids remain labelled requested. Measured grids remain labelled measured. The position and tempo readouts follow the committed processed mapping, native-rate ramp, finite loop or native continuation. Preserved or independently shifted pitch is distinguished from rate-linked pitch for native tempo ramp/brake. These are source-derived engineering readouts, not proof of perceived musical quality.

## Verification and limits

The handoff lists the exact Windows Node and browser checks, independent review and native offline sample comparisons. No real phone, owner songs, physical output, touch hardware, macOS, Linux or listening is qualified by this slice. The separate set metadata/cache and live evaluator work remains the next assigned sequence. No stems or transition selection changes are included.
