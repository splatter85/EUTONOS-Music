# EMF-S17 — phone listening (streamed) handoff

**Campaign:** EMF / `campaign-emf-001`  
**Slice:** EMF-S17  
**Disposition:** IN PROGRESS — engineering built and checked on Windows; **integration pending coordinator merge**

**Environment:** PC, Windows 11, Node v26.13.0, Chromium 151.0.7922.34 (Playwright 1.62.1), ffmpeg 8.1 essentials (libmp3lame, libopus); Windows only  
**Source / branch:** implementation commit `21546c0b6b4cfcecdebc526619b1d9596e82c46f` plus review fix-round commit `e38793435693743e18ea0b1ce43911544d7a861a` (checks below ran on its tree) on worker branch `worktree-agent-a9f63051b771978bc`, based on main `6d6c072fa1cec70c2dc54ab4a9c913589a36c5cf`; this handoff update is a following docs-only commit  
**Publication/integration:** not pushed, not merged. The coordinator owns merge, board, RAM, NAV and acceptance updates.

## Assignment and delivered changes

The owner wants to listen on a phone (screen possibly locked) to the live DJ in desktop Edge/Chrome, hear the real transitions and control the DJ from the phone, with the PC as the only audio engine. [Guide, contract and run steps](../S17_PHONE_LISTENING.md).

- `src/player.ts`: additive `createStreamTap()` / `releaseStreamTap()`; the master output gains an extra connection to a `MediaStreamAudioDestinationNode`; the output → destination path is unchanged; `dispose()` releases the tap.
- `web/phone-stream.ts`, `web/app.ts`, `web/index.html`, `web/style.css`: opt-in **Stream to phone** toggle (off by default) showing relay, control, recorder, chunks sent, session count, last phone command and errors. MediaRecorder `audio/webm;codecs=opus`, 192 kbit/s, 250 ms slices, posted strictly in order; any failure restarts a fresh session after 3 s. Phone commands arrive over SSE and press the page's own buttons / Handoff select, honouring disabled state. Stream failures are never awaited by playback.
- `scripts/phone-relay.ts` (`npm run phone`): loopback-only Node relay (built-ins only), one injectable ffmpeg encoder session at a time, `/live.mp3` fan-out with a ~64 KiB frame-aligned fast start, slow-listener drop above 512 KiB backlog, max 8 listeners, SSE command relay, sanitised status, strict phone-file allowlist, body limits, clean Ctrl+C shutdown. Prints the owner steps, including `tailscale serve --bg 4180` (not run).
- `web/phone-protocol.ts`: shared command allowlist (`play`, `stop`, `next`, `hold [enabled]`, `handoff direct|hybrid|mix`) and status sanitiser.
- `web/phone.html`, `web/phone.css`, `web/phone.ts`: phone page with Listen/Pause (phone only; pause disconnects so the delay does not grow), remote Next Song / Hold / Play (DJ) / Stop (DJ) / Handoff, now-playing, connection and stream status, Media Session metadata (`nexttrack` = DJ Next; play/pause = phone listening).
- Docs: [S17 guide](../S17_PHONE_LISTENING.md); additive entries in Current Tasks, the EMF campaign, AGENTS.md, README and the docs/handoff indexes. `docs/WORK_ITEMS.md`, RAM, NAV and `eutonos.acceptance.json` were not touched. `scripts/serve.ts` was not edited.

## Review fix round

The coordinator's review asked for eight changes. All were applied:

1. **Per-run relay token.** `crypto.randomBytes(16)` hex token per relay start. It is compared in constant time (SHA-256 digests plus `timingSafeEqual`) and required as `X-Relay-Token` on every `/api/dj/*` request (401 otherwise). The relay prints the DJ address with the token in the URL fragment (`#relayToken=`). The page moves it to `sessionStorage` and removes it from the address bar. Host, Origin and proxy-header guards are unchanged. Events now use a fetch-streamed SSE body with the header, never a query token, so 401 and 409 are visible to the page. Without a token the panel explains how to get one.
2. **Hidden-tab exception.** The label and guide name it as an explicit exception to the S02 hidden-tab pause, only while streaming, default on. Hidden-tab timing is NOT TESTED.
3. **Phone stall watchdog** (`web/phone-watchdog.ts`). If waiting/stalled lasts more than 8 s while listening, the phone disconnects and rejoins.
4. **`/live.mp3` headers.** Always 200 with no `Content-Length`, including Range probes. Adds `Accept-Ranges: none`, `Cache-Control: no-cache, no-store` and `icy-name`. iOS is NOT TESTED.
5. **Cross-site refusal.** `/live.mp3` and `/api/status` return 403 for `Sec-Fetch-Site: cross-site`.
6. **One DJ tab.** A second DJ events connection gets 409. That tab shows "Another DJ tab is streaming to the phone" and starts its recorder only after its own control connection succeeds, so it cannot replace the live audio session.
7. **ffmpeg input flags.** `-fflags nobuffer -probesize 32 -analyzeduration 0` were added. The real-ffmpeg smoke test passes with probesize 32.
8. **Tailnet exposure.** The guide states that any device on the owner's tailnet, including shared nodes, can listen and send phone commands.

New tests:
- Node: forged Host plus forged Origin with no token is refused; wrong, short and query-string tokens are refused on all DJ endpoints; preflight allows `X-Relay-Token`; a second events connection gets 409 and reconnecting after close works; per-run random token and fragment-only DJ URL; Icecast headers for a Range probe; cross-site 403; watchdog with fake timers.
- Browser: a tokenless page refuses with the help text; the token leaves the address bar; a second DJ tab is refused and the relay session count stays at 1.

## Verification and limits

| Check | Result | Scope |
| --- | --- | --- |
| `npm run check` (fix round) | PASS, exit 0: **445 Node tests** (445 pass, 0 fail, 0 cancelled, 0 skipped); fixtures check, pack validation and S11 library demo passed | 17 S17 tests: 16 in `tests/phone-relay.test.ts`, 1 tap test in `tests/player.test.ts` (first round: 442) |
| Real-ffmpeg smoke (in the Node tests) | PASS, not skipped | ffmpeg-generated 3 s WebM/Opus posted in 4 KiB chunks through the relay; 20 consecutive MPEG-1 Layer III frames, 256 kbit/s, 44.1 kHz parsed from `/live.mp3` |
| `npm run check:browser` (fix round) | PASS, exit 0, no FAIL entries | 24 native offline + 16 S09 browser checks; 4 S11 groups; Studio 15 checks; 21 mix results; **S17 phone browser check 8/8** with the real ffmpeg encoder (first round 6/6) |
| S17 browser check repeated standalone | First round 4 runs; fix round 4 runs; all exit 0 | |
| Relay CLI start | Printed instructions and `Encoder: ffmpeg (libmp3lame found).`; bad `--host` refused with usage | Process stopped forcibly, so the Ctrl+C path itself was not exercised interactively |

The S17 browser check (headless Chromium, isolated demo server and relay on ephemeral ports) observed: streaming off by default; toggle connects SSE control; after Play ≥ 8 ordered chunks ingested and MP3 frames reached a Node listener; the phone page (390 px, no overflow) shows the DJ's now/next and enables Next; relay commands Next, Hold (page button and explicit no-op), Handoff hybrid, Play-while-playing (reported ignored), Stop and Play act on the DJ page; an unknown command is 400; toggling off ends the relay session and DJ connection while playback continues; with the relay closed the toggle reports "Relay unreachable" and the audio clock keeps advancing.

Node tests cover the relay token, host/origin guards (including tailnet Host and proxy headers on DJ endpoints), CORS/preflight for the DJ origin only, phone CSRF (text/plain, foreign Origin, cross-site fetch metadata), the command allowlist, body limits, single-session replacement, sequence gaps, final, encoder start failure and retry, multi-listener fan-out, late-listener frame-aligned fast start, slow-listener drop, SSE delivery and replacement, status round trip, phone-file path safety and `close()` stopping the encoder.

**Not tested:** a real iPhone or Android phone, lock-screen controls, `tailscale serve` proxying (the relay was not reached through Tailscale), iOS Safari's handling of the endless Icecast-style MP3 and its Range probes, the stall watchdog on a real phone, background/hidden-tab playback and throttling on the PC, Windows window-occlusion, actual end-to-end delay (2–5 s is an estimate), physical output and **human listening**. **macOS/Linux: NOT RUN.** Headless Chromium output is not physical output.

## Decisions, risks and recovery

**Decided:** commands are executed by clicking the DJ page's own controls, so no DJ logic is duplicated and disabled state is respected. A command on a disabled control is reported as ignored, not retried.

**Decided (confirmed in review):** while streaming with **Keep playing while this tab is hidden** checked (default), the S02 hidden-tab auto-pause is skipped as an explicit, streaming-only exception, because the listener is on the phone. Unchecking restores S02 behaviour. Without this a minimised or occluded DJ window would silently pause the phone stream. Hidden-tab timing is NOT TESTED.

**Decided:** the DJ events use a fetch stream with the `X-Relay-Token` header instead of `EventSource` plus a query token. A token in a query string could leak into logs, and `EventSource` hides 401/409. The Sec-Fetch-Site cross-site refusal applies to `/live.mp3` and `/api/status` only, not to the phone page files, so the phone page can still be opened from a link.

**Decided:** `-fflags nobuffer -probesize 32 -analyzeduration 0` and `-flush_packets 1` are added to the owner-specified ffmpeg command for lower delay. The DJ endpoints require the per-run token and also refuse any request carrying reverse-proxy headers, on top of the loopback-Host and Origin checks, so a tailnet client cannot reach ingest through `tailscale serve`.

**Risks:** Chrome/Edge may throttle timers in a hidden tab (status posts, command handling); pages playing audio are normally exempt but this is unverified. MediaRecorder behaviour while the AudioContext is suspended (DJ paused/stopped) produces no audio, so the phone buffers until Play. ffmpeg reading WebM from stdin needs chunk 0 (header); any gap ends the session and the page restarts with a fresh header, giving an audible dropout on the phone. Phone Play from the relay relies on the page's sticky user activation (a prior click on the DJ page). Any device on the owner's tailnet, including shared nodes, that can open the serve URL can listen and use the phone controls. The tailnet ACLs are the boundary. If the relay restarts, the DJ tab's token is stale: reopen the newly printed address.

**Recovery:** if the phone stalls, check the DJ panel's error line and the relay terminal; toggle Stream to phone off and on (new session); on the phone tap Pause listening then Listen. If ffmpeg is not on PATH, run `npm run phone -- --ffmpeg PATH`.

## Next handoff

**Exactly one next slice:** **EMF-S10 — PC + owner** (owner listening), after the coordinator merges S17. S17 can be used for convenience; mixing judgements stay on the PC output.

**Owner steps for S17:** (1) `npm run demo`; (2) second terminal `npm run phone`; (3) open the DJ address it prints (ending `#relayToken=…`) in Edge/Chrome, click **Stream to phone**, press Play once on the PC; (4) once, run `tailscale serve --bg 4180` on the PC; (5) install Tailscale on the phone, sign in to the same tailnet, open `https://<pc-name>.<tailnet>.ts.net/`, tap **Listen**. Report whether iOS/Android lock-screen play/pause/next work.

**Still not done:** coordinator merge and target verification, board/RAM/NAV/acceptance updates, real-phone and lock-screen tests, macOS/Linux runs, physical output and listening.
