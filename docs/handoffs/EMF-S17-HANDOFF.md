# EMF-S17 — phone listening (streamed) handoff

**Campaign:** EMF / `campaign-emf-001`  
**Slice:** EMF-S17  
**Disposition:** IN PROGRESS — engineering built and checked on Windows; **integration pending coordinator merge**

**Environment:** PC, Windows 11, Node v26.13.0, Chromium 151.0.7922.34 (Playwright 1.62.1), ffmpeg 8.1 essentials (libmp3lame, libopus); Windows only  
**Source / branch:** implementation commit `21546c0b6b4cfcecdebc526619b1d9596e82c46f` on worker branch `worktree-agent-a9f63051b771978bc`, based on main `6d6c072fa1cec70c2dc54ab4a9c913589a36c5cf`; this handoff is a following docs-only commit  
**Publication/integration:** not pushed, not merged. The coordinator owns merge, board, RAM, NAV and acceptance updates.

## Assignment and delivered changes

The owner wants to listen on a phone (screen possibly locked) to the live DJ in desktop Edge/Chrome, hear the real transitions and control the DJ from the phone, with the PC as the only audio engine. [Guide, contract and run steps](../S17_PHONE_LISTENING.md).

- `src/player.ts`: additive `createStreamTap()` / `releaseStreamTap()`; the master output gains an extra connection to a `MediaStreamAudioDestinationNode`; the output → destination path is unchanged; `dispose()` releases the tap.
- `web/phone-stream.ts`, `web/app.ts`, `web/index.html`, `web/style.css`: opt-in **Stream to phone** toggle (off by default) showing relay, control, recorder, chunks sent, session count, last phone command and errors. MediaRecorder `audio/webm;codecs=opus`, 192 kbit/s, 250 ms slices, posted strictly in order; any failure restarts a fresh session after 3 s. Phone commands arrive over SSE and press the page's own buttons / Handoff select, honouring disabled state. Stream failures are never awaited by playback.
- `scripts/phone-relay.ts` (`npm run phone`): loopback-only Node relay (built-ins only), one injectable ffmpeg encoder session at a time, `/live.mp3` fan-out with a ~64 KiB frame-aligned fast start, slow-listener drop above 512 KiB backlog, max 8 listeners, SSE command relay, sanitised status, strict phone-file allowlist, body limits, clean Ctrl+C shutdown. Prints the owner steps, including `tailscale serve --bg 4180` (not run).
- `web/phone-protocol.ts`: shared command allowlist (`play`, `stop`, `next`, `hold [enabled]`, `handoff direct|hybrid|mix`) and status sanitiser.
- `web/phone.html`, `web/phone.css`, `web/phone.ts`: phone page with Listen/Pause (phone only; pause disconnects so the delay does not grow), remote Next Song / Hold / Play (DJ) / Stop (DJ) / Handoff, now-playing, connection and stream status, Media Session metadata (`nexttrack` = DJ Next; play/pause = phone listening).
- Docs: [S17 guide](../S17_PHONE_LISTENING.md); additive entries in Current Tasks, the EMF campaign, AGENTS.md, README and the docs/handoff indexes. `docs/WORK_ITEMS.md`, RAM, NAV and `eutonos.acceptance.json` were not touched. `scripts/serve.ts` was not edited.

## Verification and limits

| Check | Result | Scope |
| --- | --- | --- |
| `npm run check` | PASS, exit 0: **442 Node tests** (442 pass, 0 fail, 0 skipped); fixtures check, pack validation and S11 library demo passed | 14 new tests: 13 in `tests/phone-relay.test.ts`, 1 tap test in `tests/player.test.ts` |
| Real-ffmpeg smoke (in the Node tests) | PASS, not skipped | ffmpeg-generated 3 s WebM/Opus posted in 4 KiB chunks through the relay; 20 consecutive MPEG-1 Layer III frames, 256 kbit/s, 44.1 kHz parsed from `/live.mp3` |
| `npm run check:browser` | PASS, exit 0 | 24 native offline + 16 S09 browser checks; 4 S11 groups; Studio 15 checks; 21 mix results; **S17 phone browser check 6/6** with the real ffmpeg encoder |
| S17 browser check repeated standalone | 4 runs, all exit 0 | Before adding it to `check:browser` |
| Relay CLI start | Printed instructions and `Encoder: ffmpeg (libmp3lame found).`; bad `--host` refused with usage | Process stopped forcibly, so the Ctrl+C path itself was not exercised interactively |

The S17 browser check (headless Chromium, isolated demo server and relay on ephemeral ports) observed: streaming off by default; toggle connects SSE control; after Play ≥ 8 ordered chunks ingested and MP3 frames reached a Node listener; the phone page (390 px, no overflow) shows the DJ's now/next and enables Next; relay commands Next, Hold (page button and explicit no-op), Handoff hybrid, Play-while-playing (reported ignored), Stop and Play act on the DJ page; an unknown command is 400; toggling off ends the relay session and DJ connection while playback continues; with the relay closed the toggle reports "Relay unreachable" and the audio clock keeps advancing.

Node tests cover host/origin guards (including tailnet Host and proxy headers on DJ endpoints), CORS/preflight for the DJ origin only, phone CSRF (text/plain, foreign Origin, cross-site fetch metadata), the command allowlist, body limits, single-session replacement, sequence gaps, final, encoder start failure and retry, multi-listener fan-out, late-listener frame-aligned fast start, slow-listener drop, SSE delivery and replacement, status round trip, phone-file path safety and `close()` stopping the encoder.

**Not tested:** a real iPhone or Android phone, lock-screen controls, `tailscale serve` proxying (the relay was not reached through Tailscale), Safari's handling of the endless MP3 and its Range probes, background/hidden-tab playback and throttling on the PC, Windows window-occlusion, actual end-to-end delay (2–5 s is an estimate), physical output and **human listening**. **macOS/Linux: NOT RUN.** Headless Chromium output is not physical output.

## Decisions, risks and recovery

**Decided:** commands are executed by clicking the DJ page's own controls, so no DJ logic is duplicated and disabled state is respected. A command on a disabled control is reported as ignored, not retried.

**Decided (review requested):** while streaming with **Keep playing while this tab is hidden** checked (default), the S02 hidden-tab auto-pause is skipped, because the listener is on the phone. Unchecking restores S02 behaviour. Without this a minimised or occluded DJ window would silently pause the phone stream.

**Decided:** `-flush_packets 1` is added to the owner-specified ffmpeg command so MP3 frames are not held in ffmpeg's output buffer (lower delay). The DJ endpoints refuse any request carrying reverse-proxy headers, in addition to the loopback-Host and Origin checks, so a tailnet client cannot reach ingest through `tailscale serve`.

**Risks:** Chrome/Edge may throttle timers in a hidden tab (status posts, command handling); pages playing audio are normally exempt but this is unverified. MediaRecorder behaviour while the AudioContext is suspended (DJ paused/stopped) produces no audio, so the phone buffers until Play. ffmpeg reading WebM from stdin needs chunk 0 (header); any gap ends the session and the page restarts with a fresh header, giving an audible dropout on the phone. Phone Play from the relay relies on the page's sticky user activation (a prior click on the DJ page). Anyone on the owner's tailnet who can open the serve URL can listen and use the phone controls.

**Recovery:** if the phone stalls, check the DJ panel's error line and the relay terminal; toggle Stream to phone off and on (new session); on the phone tap Pause listening then Listen. If ffmpeg is not on PATH, run `npm run phone -- --ffmpeg PATH`.

## Next handoff

**Exactly one next slice:** **EMF-S10 — PC + owner** (owner listening), after the coordinator merges S17. S17 can be used for convenience; mixing judgements stay on the PC output.

**Owner steps for S17:** (1) `npm run demo`, open http://127.0.0.1:4173/ in Edge/Chrome; (2) second terminal `npm run phone`; (3) click **Stream to phone**, press Play once on the PC; (4) once, run `tailscale serve --bg 4180` on the PC; (5) install Tailscale on the phone, sign in to the same tailnet, open `https://<pc-name>.<tailnet>.ts.net/`, tap **Listen**. Report whether iOS/Android lock-screen play/pause/next work.

**Still not done:** coordinator merge and target verification, board/RAM/NAV/acceptance updates, real-phone and lock-screen tests, macOS/Linux runs, physical output and listening.
