# S17 — Phone listening (streamed)

Scope: **EMF-S17, PC, IN PROGRESS (engineering built and checked on Windows; pending coordinator merge)**. The [EMF campaign](campaigns/EMF_INITIAL_INFRASTRUCTURE.md) and [Current Tasks](CURRENT_TASKS.md) own status; the [handoff](handoffs/EMF-S17-HANDOFF.md) holds evidence.

The owner listens on a phone (iPhone or Android, screen may be locked) to the **live DJ** running in desktop Edge/Chrome on the Windows PC, hears the real transitions, and controls the DJ from the phone. **The PC browser stays the only audio engine.** The phone receives a lossy MP3 copy of the PC's master output and sends allowlisted commands back.

## Architecture

```text
DJ page http://127.0.0.1:4173/ (web/index.html, web/app.ts, SmallPlayer)
  master output GainNode ──► AudioContext.destination        (unchanged PC path)
          └────────────────► MediaStreamAudioDestinationNode  (S17 tap, extra connection)
                                   │ MediaRecorder audio/webm;codecs=opus, 192 kbit/s, 250 ms slices
                                   ▼ POST /api/dj/ingest?session=…&seq=N   (in order)
Phone relay http://127.0.0.1:4180/ (scripts/phone-relay.ts, Node built-ins only)
  one ffmpeg: -f webm -i pipe:0 → libmp3lame 256 kbit/s, 44.1 kHz stereo → pipe:1
          └─ fan-out: GET /live.mp3 (endless audio/mpeg) ─► any number of phone listeners
  phone POST /api/control ─► SSE GET /api/dj/events ─► DJ page presses its own buttons
  DJ page POST /api/dj/status ─► phone GET /api/status (polled)
tailscale serve --bg 4180  (run by the owner) ─► https://<pc-name>.<tailnet>.ts.net/ on the phone
```

- `SmallPlayer.createStreamTap()` connects the single master output to a `MediaStreamAudioDestinationNode`; `releaseStreamTap()` removes only that connection. The output → destination path never changes, so streaming cannot alter what the PC plays. `dispose()` also releases the tap.
- The DJ page (`web/phone-stream.ts`) records the tap, posts chunks strictly in order and retries with a fresh session (new WebM header) after any failure. Nothing in playback awaits the stream; a missing or failing relay shows an error in the stream panel and the DJ keeps playing.
- Phone commands are executed by **the DJ page's own controls** (`button.click()` / the Handoff select's change event), so FIFO, Hold, Stop and the current disabled state apply exactly as for a click on the PC. A command on a disabled control is reported as ignored.
- The relay ([`scripts/phone-relay.ts`](../scripts/phone-relay.ts)) keeps about 64 KiB (~2 s) of recent MP3 for a fast start, aligned to an MP3 frame header. A listener whose unsent backlog exceeds 512 KiB is dropped (it can reconnect) rather than buffered without bound. At most 8 listeners. One ingest session at a time: a new session (chunk 0) replaces the old one and restarts ffmpeg; a sequence gap or unknown session is refused with 409 and ends the session, so the page restarts with a fresh header. `-flush_packets 1` is added to the owner-specified ffmpeg command so MP3 frames are not held in ffmpeg's output buffer.

The protocol ([`web/phone-protocol.ts`](../web/phone-protocol.ts)) is pure data validation shared by relay, DJ page and phone page:

| Command (phone → DJ) | Effect on the PC |
| --- | --- |
| `{"command":"next"}` | Presses **Next Song** |
| `{"command":"hold"}` / `{"command":"hold","enabled":true}` | Presses **Hold** (an explicit `enabled` equal to the current state is a no-op) |
| `{"command":"stop"}` | Presses **Stop** |
| `{"command":"play"}` | Presses **Play** (start or resume) |
| `{"command":"handoff","mode":"direct"\|"hybrid"\|"mix"}` | Sets the **Handoff** select for the next selection |

Unknown commands, fields or modes are refused (400). DJ status is copied into a fixed shape with bounded strings and strict booleans.

## Security split

| Endpoint | Who | Guard |
| --- | --- | --- |
| `POST /api/dj/ingest`, `GET /api/dj/events`, `POST /api/dj/status` (+ `OPTIONS`) | DJ page only | Loopback `Host`; `Origin` exactly `http://127.0.0.1:4173` or `http://localhost:4173` (replace with repeatable `--dj-origin`, loopback only); refused when any reverse-proxy header (`X-Forwarded-*`, `Forwarded`, `Tailscale-User-*`) is present. CORS and preflight are answered for that origin only. |
| `GET /`, `/phone.css`, `/phone.js`, `/live.mp3`, `/api/status`, `POST /api/control` | Phone | `Host` is loopback, ends in `.ts.net`, or is a repeatable `--allow-host NAME`; anything else is 400 (DNS-rebinding guard). `/api/control` needs `Content-Type: application/json` and a same-origin or absent `Origin` / `Sec-Fetch-Site`, so foreign pages cannot fire commands. |

The phone side cannot inject audio: ingest exists only on the DJ guard. Body limits: ingest 1 MiB, status 16 KiB, control 1 KiB. Phone files come from a fixed allowlist with the same raw-path checks and realpath/symlink-alias refusal as `scripts/serve.ts`, plus a restrictive Content-Security-Policy. The relay binds only `127.0.0.1`; there is no LAN option. Anyone on the owner's tailnet who can reach the serve URL can listen and press the phone controls; the tailnet is the access boundary.

## How to run (owner, Windows PC)

1. Terminal 1: `npm run demo`, then open http://127.0.0.1:4173/ in **Edge or Chrome** on the PC (choose the pack as usual).
2. Terminal 2: `npm run phone` (builds, then starts the relay on 127.0.0.1:4180 and prints these steps). Options: `--port N`, `--ffmpeg PATH` (default `ffmpeg` from PATH; needs libmp3lame), `--allow-host NAME`, `--dj-origin ORIGIN`.
3. On the DJ page click **Stream to phone** (off by default). The panel shows relay/control/recorder state, chunks sent and errors. Press **Play** once on the PC (that click also gives the page the user activation that later lets a phone **Play** start audio).
4. Once, on the PC: `tailscale serve --bg 4180`. (`tailscale serve status` shows it; `tailscale serve reset` removes all serve configuration.) The agent did not run this.
5. Install Tailscale on the phone, sign in to the same tailnet, open `https://<pc-name>.<tailnet>.ts.net/`, tap **Listen**.

Phone page: **Listen / Pause listening** only affects the phone (pausing disconnects, and Listen rejoins live so the delay does not grow). **Next Song, Hold, Play (DJ), Stop (DJ)** and **Handoff** act on the PC. The Media Session API supplies lock-screen title/state; lock-screen *next track* = DJ **Next Song**, play/pause = phone listening only.

To stop: turn **Stream to phone** off (recorder, tap, events and timers are torn down; the relay ends the session), then Ctrl+C in the relay terminal (ffmpeg is stopped).

## PC tab hidden

S02 pauses the DJ when its tab becomes hidden. While **Stream to phone** is on and **Keep playing while this tab is hidden** is checked (the default), that auto-pause is skipped, because the listener is on the phone. Turn the checkbox off to keep the S02 policy. Background playback, timer throttling of the status/command path and Windows window-occlusion behaviour are **NOT TESTED**; keep the DJ tab in its own visible window if anything stalls.

## Limits

- **Delay:** the phone hears the PC roughly 2–5 s late (recorder slices, encoder, network and phone buffering). Controls act on the PC immediately, so a phone **Next** is heard on the phone a few seconds after the PC changes. The figure is an engineering estimate, not a measurement on a real phone.
- **Lossy path:** Opus 192 kbit/s then MP3 256 kbit/s changes what is heard. Judge transition or mixing defects against the PC output, not the phone. A phone speaker is unsuitable for bass judgement.
- While the DJ is stopped or paused its AudioContext is suspended, so no audio reaches the phone; the phone shows "Buffering" and resumes when the DJ plays.
- **iOS/Android lock-screen behaviour, real-phone playback and Tailscale serve proxying: NOT TESTED.** No real device was used. Safari's handling of an endless MP3 (including its Range probes, answered with the full live stream) is unverified.
- **Physical output and listening: NOT TESTED.** Passing checks establish engineering behaviour only. Windows only; macOS/Linux not run.

## Files

| File | Role |
| --- | --- |
| `scripts/phone-relay.ts` | Relay, guards, encoder session, fan-out, SSE, CLI (`npm run phone`) |
| `web/phone-protocol.ts` | Command allowlist and status sanitiser |
| `web/phone-stream.ts` | DJ-page streaming/control client |
| `web/app.ts`, `web/index.html`, `web/style.css` | Stream to phone panel and command execution through existing controls |
| `src/player.ts` | `createStreamTap()` / `releaseStreamTap()` |
| `web/phone.html`, `web/phone.css`, `web/phone.ts` | Phone page |
| `tests/phone-relay.test.ts`, `tests/player.test.ts` | Node tests incl. real-ffmpeg smoke |
| `scripts/phone-browser-check.ts` | Browser check (`npm run check:phone`, part of `check:browser`) |
