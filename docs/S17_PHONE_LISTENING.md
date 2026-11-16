# S17 — Phone listening (streamed)

Scope: **EMF-S17, PC, IN MAIN for engineering scope (Windows only; real phone, lock screen and listening NOT TESTED)**. The [EMF campaign](campaigns/EMF_INITIAL_INFRASTRUCTURE.md) and [Current Tasks](CURRENT_TASKS.md) own status; the [handoff](handoffs/EMF-S17-HANDOFF.md) holds evidence.

The owner listens on a phone (iPhone or Android, screen may be locked) to the **live DJ** running in desktop Edge/Chrome on the Windows PC, hears the real transitions, and controls the DJ from the phone. **The PC browser stays the only audio engine.** The phone receives a lossy MP3 copy of the PC's master output and sends allowlisted commands back.

## Architecture

```text
DJ page http://127.0.0.1:4173/ (web/index.html, web/app.ts, SmallPlayer)
  master output GainNode ──► AudioContext.destination        (unchanged PC path)
          └────────────────► MediaStreamAudioDestinationNode  (S17 tap, extra connection)
                                   │ MediaRecorder audio/webm;codecs=opus, 192 kbit/s, 250 ms slices
                                   ▼ POST /api/dj/ingest?session=…&seq=N   (in order)
Phone relay http://127.0.0.1:4180/ (scripts/phone-relay.ts, Node built-ins only)
  one ffmpeg: -fflags nobuffer -probesize 32 -analyzeduration 0 -f webm -i pipe:0
              → libmp3lame 256 kbit/s, 44.1 kHz stereo → -flush_packets 1 pipe:1
          └─ fan-out: GET /live.mp3 (endless audio/mpeg) ─► up to 8 phone listeners
  phone POST /api/control ─► SSE GET /api/dj/events (fetch-streamed) ─► DJ page presses its own buttons
  DJ page POST /api/dj/status ─► phone GET /api/status (polled)
tailscale serve --bg 4180  (run by the owner) ─► https://<pc-name>.<tailnet>.ts.net/ on the phone
```

- `SmallPlayer.createStreamTap()` connects the single master output to a `MediaStreamAudioDestinationNode`; `releaseStreamTap()` removes only that connection. The output → destination path never changes, so streaming cannot alter what the PC plays. `dispose()` also releases the tap.
- The DJ page (`web/phone-stream.ts`) first opens the control connection, then records the tap, posts chunks strictly in order and retries with a fresh session (new WebM header) after any failure. Nothing in playback awaits the stream; a missing or failing relay shows an error in the stream panel and the DJ keeps playing.
- Control events are Server-Sent Events read with `fetch()` and a streamed body, not `EventSource`: `EventSource` cannot send the `X-Relay-Token` header and hides 401/409 status codes. The page reconnects every 3 s (5 s while refused as a second tab) until streaming is turned off.
- **One DJ tab at a time.** A second `GET /api/dj/events` while one is open is refused with 409; that tab shows "Another DJ tab is streaming to the phone" and never starts its recorder, so it cannot replace the streaming tab's audio session. It retries and takes over once the first tab stops or closes.
- Phone commands are executed by **the DJ page's own controls** (`button.click()` / the Handoff select's change event), so FIFO, Hold, Stop and the current disabled state apply exactly as for a click on the PC. A command on a disabled control is reported as ignored.
- The relay ([`scripts/phone-relay.ts`](../scripts/phone-relay.ts)) keeps about 64 KiB (~2 s) of recent MP3 for a fast start, aligned to an MP3 frame header. A listener whose unsent backlog exceeds 512 KiB is dropped (it can reconnect) rather than buffered without bound. At most 8 listeners. One ingest session at a time: a new session (chunk 0) replaces the old one and restarts ffmpeg; a sequence gap or unknown session is refused with 409 and ends the session, so the page restarts with a fresh header. Two additions to the owner-specified ffmpeg command lower delay: `-fflags nobuffer -probesize 32 -analyzeduration 0` on the input (the real-ffmpeg smoke test and the browser check pass with the smallest probe size, 32 bytes), and `-flush_packets 1` so MP3 frames are not held in ffmpeg's output buffer.
- `/live.mp3` behaves like an Icecast/radio stream: `200` with no `Content-Length`, `Accept-Ranges: none`, `Cache-Control: no-cache, no-store` and an `icy-name` header, for every request including `Range: bytes=0-1` probes (iOS Safari sends these). Whether iOS accepts this is **NOT TESTED**.
- The phone page has a stall watchdog (`web/phone-watchdog.ts`): if the audio element reports `waiting`/`stalled` and does not play again within 8 s while the phone wants to listen, it disconnects and rejoins live (with backoff).

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
| `POST /api/dj/ingest`, `GET /api/dj/events`, `POST /api/dj/status`, `GET /api/dj/wanted`, `POST /api/dj/rating`, `GET /api/dj/ratings` (+ `OPTIONS`) | DJ page only | **Per-run secret token** in the `X-Relay-Token` header (401 without it); plus loopback `Host`; `Origin` exactly `http://127.0.0.1:4173` or `http://localhost:4173` (replace with repeatable `--dj-origin`, loopback only); refused when any reverse-proxy header (`X-Forwarded-*`, `Forwarded`, `Tailscale-User-*`) is present. CORS and preflight (which carries no token) are answered for that origin only. |
| `GET /`, `/phone.css`, `/phone.js`, `/phone-watchdog.js`, `/feedback-vocabulary.js`, `/live.mp3`, `/api/status`, `POST /api/control` | Phone | `Host` is loopback, ends in `.ts.net`, or is a repeatable `--allow-host NAME`; anything else is 400 (DNS-rebinding guard). `/live.mp3` and `/api/status` refuse `Sec-Fetch-Site: cross-site`. `/api/control` needs `Content-Type: application/json` and a same-origin or absent `Origin` / `Sec-Fetch-Site`, so foreign pages cannot fire commands. |

**Relay token.** Host and Origin headers can be forged by any non-browser client that reaches the port, so they are kept only as extra layers. The real DJ gate is a secret generated at every relay start (`crypto.randomBytes(16)`, 32 hex characters), compared in constant time (SHA-256 digests with `timingSafeEqual`). The relay prints a ready-to-open DJ address such as `http://127.0.0.1:4173/?relay=http%3A%2F%2F127.0.0.1%3A4180#relayToken=<token>`. The token sits in the URL **fragment**, which browsers never send in requests, so it does not reach server logs or proxies. The DJ page reads it, keeps it in `sessionStorage` for that tab (so changing pack keeps it) and removes it from the address bar. Every `/api/dj/*` request then carries it as `X-Relay-Token`; it is never accepted from a query string. Without a valid token **Stream to phone** refuses and tells the owner to open the printed address. The token changes on every relay restart, so reopen the newly printed address.

The phone side cannot inject audio: ingest exists only behind the DJ guard and token. Body limits: ingest 1 MiB, status 16 KiB, control 2 KiB, rating 24 KiB. Phone files come from a fixed allowlist with the same raw-path checks and realpath/symlink-alias refusal as `scripts/serve.ts`, plus a restrictive Content-Security-Policy. The relay binds only `127.0.0.1`; there is no LAN option.

**Tailnet exposure.** Once `tailscale serve` is on, **any device that can reach the PC on the owner's tailnet, including nodes shared into it, can open the phone page, listen to the stream and send the phone commands** (Next, Hold, Play, Stop, Handoff). The phone side has no login of its own; the tailnet and its ACLs are the access boundary. Such devices still cannot reach the DJ endpoints or inject audio.

## How to run (owner, Windows PC)

**Hands-off host (recommended): `npm run phone:host`.** One command builds, starts the file server (4173, or reuses a running `npm run demo`) and the phone relay (4180), then opens the Studio set page (`studio.html?pack=set&tab=dj`) in a **dedicated Edge window (Chrome if Edge is missing)**, minimized, in `--app=` mode, passing the relay token in the URL fragment itself. That window is started with Chromium's documented `--autoplay-policy=no-user-gesture-required` switch and a **throwaway `--user-data-dir` under the OS temp folder** (`eutonos-phone-host-*`, deleted when the host stops), so a phone **Play** starts sound on the PC with **no click on the PC** and **Stream to phone** turns itself on when the phone page opens. It never uses the owner's real browser profile and changes no browser setting. It does not run `tailscale serve`; it prints the address to run yourself. Options: `--visible` (not minimized), `--browser PATH`, `--ffmpeg PATH`, `--no-browser` (print the URL to open in a browser you started with that flag). Ctrl+C (or closing the DJ window) stops everything and removes the temporary profile. Leave the DJ window open: closing it ends sound. Because that window is minimized, the Studio page's **Keep playing when this tab is hidden (only while streaming)** option is now checked by default so the hidden-tab pause does not stop the DJ (untick it to restore the old pause). The launcher passes the token in a process argument, readable by other local users of this PC while it runs; the token is per run and the relay is loopback only. Windows is the tested path; the browser lookup also covers macOS and Linux paths but those were not run.

Manual route (same pieces by hand):

1. Terminal 1: `npm run demo`.
2. Terminal 2: `npm run phone` (builds, then starts the relay on 127.0.0.1:4180 and prints these steps). Options: `--port N`, `--ffmpeg PATH` (default `ffmpeg` from PATH; needs libmp3lame), `--allow-host NAME`, `--dj-origin ORIGIN`.
3. Open **the DJ address the relay printed** (it ends with `#relayToken=…`) in **Edge or Chrome** on the PC. In a normal browser window the autoplay policy applies: the first Play must come from a click on the PC page (or see the fallback below).
4. Once, on the PC: `tailscale serve --bg 4180`. (`tailscale serve status` shows it; `tailscale serve reset` removes all serve configuration.) The agent did not run this.
5. Install Tailscale on the phone, sign in to the same tailnet, open `https://<pc-name>.<tailnet>.ts.net/` (it can be added to the home screen).

### Phone page: one remote plus speaker

The main view is small: **Now playing**, one big **Play/Pause**, a one-line status, **Next** (and **Auto** on the set page), a **Next up** card, a **Handover** card and a collapsed **More**.

- **Play** sends the DJ `play` command *and* starts this phone's sound in the same tap (the tap is the gesture iOS needs). **Pause** sends `stop` and releases the phone's sound. The button follows the relay's real DJ state (`idle`, `loading` shows "Starting…", `playing`/`scheduled` shows Pause, `needs-click`, error), never an optimistic guess (pure logic: `web/phone-ui.ts`).
- Opening the page while the DJ already plays joins the sound by itself once. If the phone refuses audio without a tap, the page says so in one line and the **next tap anywhere** starts the sound; there is no Listen button. A DJ that really stopped releases the phone's sound; a Play press has a 20 s grace so the brief idle state before loading does not drop it.
- **Next up** shows the next song (the DJ's armed next, else the head of the queue) and `nextStatus`: *Preparing the handover…*, *Ready — handover prepared* or *Queued — prepared when you press Next / Auto prepares it once this song is in*. Set mode analyzes and prepares B only when Next or Auto asks (S18/S21); this slice does not pre-arm it, so "Ready" appears after Next or Auto, not while the song merely plays.
- **Pick a different next song** lists the queue; tapping an entry sends `{command:'set-next', songId}`. The Studio set page validates the id against its **current queue**: an unknown id is refused (`refused: <id> is not in the queue`), the head is a no-op (`... is already next`), anything else is moved to the front with the same `reorderQueue` the Queue arrows use, so an outstanding Next re-targets and re-prepares for the new head. Ids must match `[A-Za-z0-9._:-]{1,120}` (no paths) at the relay; older DJ pages answer `ignored`.
- **Handover card** (set page): the upcoming transition and the last one played in plain words (for example *Smooth blend*, *Bass swap*, *Bass handover with 2-bar gap*, *Echo out*, *Filter sweep*, *Tempo meet in the middle*, *Clean cut (last resort)*) with bars of overlap, tempo change, where B enters (`enters at 1:12`) and a *Fallback after N failed pre-check(s)* note. It reads the same plan record and summary as the Studio **Why this handover** panel (`web/phone-transition.ts`); the EQ choreography name is under **More**. Plan data, not listening evidence.
- **Rate the last transition** (card under Next up, shown once a handover has finished): four big buttons (Love, Like, OK, Dislike) and a collapsed **Why?** with 15 reason chips (multi-select) and a note of up to 200 characters. Pick chips first, then tap a rating: one tap sends `{command:'rate', rating, tags[], note?, planId?}`. The card names the handover being rated (the plan that most recently **finished** playing, not the one being prepared) and carries its plan id; the DJ page refuses with *the last handover changed* if the view is stale, and refuses with *nothing to rate* before any handover finished. Re-rating the same plan replaces the earlier rating. The confirmation line reports only what the PC returned: *Sent*, *PC has it* (held in the DJ page, queued for the file) or *Saved on the PC* (written to the file). The Studio set panel rates through the same code path (`rateLast`).
- **Durable ratings (PC).** The relay is the only writer of `local/transition-ratings/ratings.jsonl` (gitignored, never committed). `POST /api/dj/rating` takes one `em.transition-feedback.v1` record, validates and re-sanitizes it (unknown fields refused with 400, 24 KiB body cap, 16 KiB line cap, 2 MiB file cap) and appends one line with a single append write (earlier lines are never rewritten; the same plan id and time is a no-op). Directories are created component by component and the relay refuses symlinks, junctions and anything that is not a plain directory or file. `GET /api/dj/ratings` returns the latest rating per plan plus line and skipped counts. The DJ page keeps a localStorage cache and a queue: the file wins when the relay is reachable, and queued ratings are sent later without duplicates. Schema and report: [S21](S21_TRANSITION_PLANNER.md#transition-feedback-and-report).
- **More** holds Hold, Handoff, DJ/stream/command status and the explanatory notes. Fields the DJ page does not send (`queue`, `nextStatus`, `canSetNext`, `transitionNext`, `transitionLast`) are optional: the page still works against an older DJ page.
- Lock screen: Media Session play/pause map to Play/Pause and *next track* to Next (not tested on a phone).

To stop: Pause on the phone, turn **Stream to phone** off on the PC page (recorder, tap, events and timers are torn down; the relay ends the session), then Ctrl+C in the host or relay terminal (ffmpeg is stopped).

### Needs-click state (fallback only)

A normal browser keeps the `AudioContext` suspended until a real click on the page, so a remote Play would sit on "Getting ready…" (observed live). Both DJ pages now watch for it: a Play that stays `loading` on a suspended context for 1.5 s reports state **`needs-click`** (the phone shows "Tap play on the PC page once") and the PC page shows a **"Click here once to allow sound"** overlay; the click resumes the context and the pending Play proceeds. This never bypasses the policy. The supported way to avoid it is `npm run phone:host`.

Verified in `scripts/phone-browser-check.ts` with real Edge (Chrome as fallback) headless: without the flag a page-created `AudioContext` stays suspended and a remote Play reports `needs-click`; with the flag it runs, a remote Play streams chunks with no click and no overlay. Playwright's bundled Chromium ignores the switch and `page.evaluate()` counts as a gesture, so that stage uses installed Edge/Chrome and reports NOT TESTED if neither exists.

## Auto-start when the phone connects

The Studio set page (opened from the relay-printed address, so a token exists) has a **Start automatically when the phone connects** checkbox, default on and remembered in `localStorage` (failures ignored). While **Stream to phone** is off, the page polls `GET /api/dj/wanted` every 2 s. This endpoint has the same guards as the other `/api/dj/*` routes (token, loopback Host, DJ Origin, no proxy headers) and returns `{wanted, phoneSeenMs, listeners}`. `wanted` is true when a phone-side request (`/api/status`, `/live.mp3`, `/api/control`; not cross-site, never a DJ request) was seen in the last 8 s or a listener is connected. When it turns true the page calls the same start path as the toggle and shows "Phone connected - streaming started automatically". If the pack is not ready the start fails quietly and is retried on a later poll. Fetch errors are ignored. The phone still cannot start a recorder by itself: the DJ page decides, and it only ever starts its own streaming.

**20 s pause rule.** If the owner turns streaming off by hand, auto-start stays paused until the phone has been absent (`wanted` false) for at least 20 s and then reappears, so a phone page left open cannot switch it straight back on. The `app.ts` demo page is not wired to auto-start. Not exercised by the browser check (see handoff); covered by relay and decision-logic unit tests.

## PC tab hidden

**Explicit exception to the S02 policy.** [S02](S02_PLAYER.md#page-and-device-lifecycle) pauses the DJ when its tab becomes hidden and requires an explicit Resume. S17 makes one scoped exception: **only while Stream to phone is on** and **Keep playing while this tab is hidden** is checked, the auto-pause is skipped, because the listener is on the phone. The checkbox defaults to **on**, because otherwise minimising or covering the DJ window would silently stop the phone stream. Uncheck it to keep the S02 policy while streaming; with streaming off, S02 applies unchanged. Hidden-tab timing is **NOT TESTED**: background audio scheduling, timer throttling of the status/command path and Windows window-occlusion behaviour were not exercised. Keep the DJ tab in its own visible window if anything stalls.

## Limits

- **Delay:** the phone hears the PC roughly 2–5 s late (recorder slices, encoder, network and phone buffering). Controls act on the PC immediately, so a phone **Next** is heard on the phone a few seconds after the PC changes. The figure is an engineering estimate, not a measurement on a real phone.
- **Lossy path:** Opus 192 kbit/s then MP3 256 kbit/s changes what is heard. Judge transition or mixing defects against the PC output, not the phone. A phone speaker is unsuitable for bass judgement.
- While the DJ is stopped or paused its AudioContext is suspended, so no audio reaches the phone; the phone shows "Buffering" and resumes when the DJ plays.
- **iOS/Android lock-screen behaviour, real-phone playback and Tailscale serve proxying: NOT TESTED.** No real device was used. iOS Safari's handling of the endless Icecast-style MP3 (including its Range probes, answered with 200 and the live stream) is unverified, as is the stall watchdog on a real phone.
- **Physical output and listening: NOT TESTED.** Passing checks establish engineering behaviour only. Windows only; macOS/Linux not run.

## Files

| File | Role |
| --- | --- |
| `scripts/phone-relay.ts` | Relay, guards, encoder session, fan-out, SSE, CLI (`npm run phone`) |
| `web/phone-protocol.ts` | Command allowlist and status sanitiser |
| `web/phone-stream.ts` | DJ-page streaming/control client |
| `web/app.ts`, `web/index.html`, `web/style.css` | Stream to phone panel and command execution through existing controls |
| `src/player.ts` | `createStreamTap()` / `releaseStreamTap()` |
| `web/phone.html`, `web/phone.css`, `web/phone.ts` | Phone page (single Play/Pause, Next-up, picker, handover card, More) |
| `web/phone-ui.ts` | Pure Play/Pause state machine and phone-audio attach/detach rule |
| `web/feedback-vocabulary.ts`, `web/transition-feedback.ts`, `web/transition-feedback-store.ts`, `scripts/transition-feedback-file.ts` | Rating vocabulary, `em.transition-feedback.v1` schema, browser cache/queue, relay file writer |
| `scripts/transitions-report.ts` | `npm run transitions:report` |
| `web/phone-transition.ts` | Plain-word handover summary from the S21 plan data |
| `web/audio-gate.ts` | `needs-click` detection and the PC "Click here once" overlay (fallback) |
| `scripts/phone-host.ts` | `npm run phone:host`: server + relay + dedicated autoplay-flag Edge/Chrome window with a temporary profile |
| `tests/phone-ui.test.ts` | Node tests for the above, including the launcher arguments |
| `web/phone-watchdog.ts` | Phone stall watchdog (reconnect after ~8 s of waiting/stalled) |
| `tests/phone-relay.test.ts`, `tests/player.test.ts` | Node tests incl. real-ffmpeg smoke |
| `scripts/phone-browser-check.ts` | Browser check (`npm run check:phone`, part of `check:browser`) |
