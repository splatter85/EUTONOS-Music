# S02 — small Web Audio player

Document ID: `EM-D019`

Implemented scope: `EMF-S02`, `campaign-emf-001`. [Campaign](campaigns/EMF_INITIAL_INFRASTRUCTURE.md) owns live status; [slice handoff](handoffs/EMF-S02-HANDOFF.md) records executed evidence.

The browser demo plays the two original S01 recordings independently and schedules the pack's one directed A→B route. It uses native `AudioBufferSourceNode` and `GainNode` with one `AudioContext`. There are no runtime packages, external services, DAW requirements or new audio assets. The [S01 format and fixtures](S01_FOUNDATION.md) remain unchanged. DJ selection, the request queue and live procedural performance belong to later slices.

## Run on Windows, macOS or Linux

Install Node.js **24.x**, then run these commands from the repository root in PowerShell, Command Prompt or a Unix shell:

```sh
npm ci --ignore-scripts
npm run check
npm run demo
```

Open **http://127.0.0.1:4173/** in a current browser that supports Web Audio, Web Crypto and Web Locks. Use the same origin and port for every demo tab. The local server is bound to loopback and serves only the demo's public files; it is not a production server or a control API. `file://` loading is unsupported. An alternate port is available with `npm run demo -- --port 4174`. Stop the server with Ctrl+C.

1. Wait for **Ready · fixture pack validated**. No audio context or sound starts on page load.
2. Press **Play A** or **Play B**. Each starts that recording from its entry cue; pressing either again replaces the current session and cancels its pending handoff.
3. To try the transition, press **Play A**, then **Schedule A → B** promptly, before A reaches its eight-second exit. A 100 ms scheduling lead rejects a request too close to the boundary. A late request reports the reason and leaves A playing to its natural end.
4. **Pause** suspends the audio clock, including a pending or active crossfade. **Resume** continues from that frozen timeline. **Stop** releases all current and future voices. **Mute/Volume** act immediately and do not wait for a phrase boundary.

### The authored route

| Position relative to A's scheduled start | Scheduled result |
| --- | --- |
| 0 seconds | A enters at its `entry` cue. |
| 8 seconds | A reaches quarter 16, B enters at quarter 0, and the linear crossfade begins. |
| 12 seconds | The eight-quarter/four-second overlap ends. A stops at zero gain; B continues. |
| 24 seconds | B's finite 16-second recording ends. Nothing loops or auto-selects another track. |

This is a checked engineering fixture at 120 BPM, 4/4, constant authored A/C/E harmony. Linear complementary gains avoid adding full-level recordings throughout the overlap. They do not establish perceived loudness, bass ownership, tail quality or a pleasant musical transition. Listening approval remains separate.

## One clock and the shared source seam

`WebAudioClock` derives absolute frames from `AudioContext.currentTime` and the context's actual sample rate. `RecordedSource` implements S01's `prepare`, `scheduleStart`, `getValidExits`, `transitionOut`, `stop` and `release`. Sources retain their caller's exact clock/context. A replacement/Stop invalidates the engine generation; stale plans are refused and cleanup remains legal.

Cue arithmetic first honors the authored file domain:

```text
native cue frame = first_downbeat_frame + round(quarters × 60 × file sample rate / BPM)
output cue frame = round(native cue frame × context sample rate / file sample rate)
absolute exit = start frame + output exit frame − selected output entry frame
```

The decoded buffer and the entry offset use the context's output frame domain. The outgoing fade, incoming start/fade and outgoing stop are scheduled in native Web Audio with the same absolute frame stamps. UI animation frames only read state; they never initiate musical events. The planner rechecks the exact directed route, revisions, cues, tempo, harmony, eligibility, remaining body and scheduling lead before committing.

Preparation validates the manifest, all six WAV byte counts/hashes/PCM metadata, and presence of the referenced rights evidence. Fixture mode is an explicit opt-in; `unreviewed` material stays ineligible. The two recordings are decoded before a transition can be committed. Manifest/evidence/response sizes are bounded; the demo permits at most 16 MiB of packed audio and 64 MiB of decoded recording samples. This is not S06's general importer.

`SmallPlayer` is the one in-page transport owner. Its operation counter prevents an older decode/resume/preparation from scheduling sound after a newer Pause, Stop or replacement. Now/Next distinguish requested/preparing, future scheduled and clock-active recordings. During the overlap both recordings appear in Now. Paused and muted state are explicit. These are renderer states, not measurements at a listener's speakers. S03 will connect the existing S01 control contract and DJ; S02 does not pretend its direct buttons implement that broader API.

## Page and device lifecycle

| Event | S02 behavior / limit |
| --- | --- |
| First Play | Creates one context from a user gesture; awaits decode and ownership before scheduling any source. |
| Duplicate same-origin tab | Web Locks grants one owner. A second Play reports a conflict; it does not queue automatic playback or steal ownership. |
| Pause | Gates output immediately, suspends the context and retains the source/transition position and ownership. |
| Tab hidden | Pauses and requires explicit Resume after return. Background continuous listening is intentionally not qualified in S02. |
| Stop / finite playback end | Cancels or ends voices, silences output and releases the app's ownership lock. |
| Close / navigation / pagehide | Releases sources and ownership, closes the context; a restored page needs a new Play. |
| Browser/OS interruption | An observed non-running context becomes paused; unsolicited recovery is gated and suspended. Actual device loss and OS sleep behavior still need real-host tests. |
| Missing/corrupt media or decode failure | Visible error; no fallback to unvalidated audio. |
| New Play while preparation is pending | Only the latest operation may schedule sources. |

Web Locks coordinates cooperating tabs in one origin/browser storage partition. It is **not** an exclusive operating-system audio-device lock: other browsers, profiles, ports and applications remain outside its scope. Use one demo origin. No cross-device control, persistent session, automatic failover, global audition routing or browser-independent playback is implemented.

## Verification surfaces

`npm run check` compiles the player/UI/server and runs Node tests, including transport/source doubles, loader failures, local HTTP handling, and the unchanged S01 fixture checks. A test double verifies scheduling calls and state transitions; it does not produce audio.

Open **http://127.0.0.1:4173/checks.html** and press **Run offline checks** for native browser evidence. The page validates and decodes all six fixtures, renders the actual A→B implementation at 48 kHz and 44.1 kHz, compares every output sample with the independently calculated envelope/offset expectation, checks a released future source produces silence, and tests a diagnostic pickup/nonzero entry. Its explicit sample-amplitude tolerance is `0.000003`; the report includes the measured maximum error, peak and absolute event frames. This is a numerical offline-render tolerance, not a latency or listening-quality guarantee. Diagnostics do not change the committed fixture pack.

Actual run results, browser/OS identity, source pin, review disposition and unrun lifecycle/device checks are in the [S02 handoff](handoffs/EMF-S02-HANDOFF.md). CI on Windows/macOS/Linux establishes portable Node behavior. A browser render on one named environment does not qualify every browser, OS or physical output path.

For repeatable automated browser checks, install the pinned Playwright Chromium build once, then run:

```sh
npx playwright install chromium
npm run check:browser
```

On Linux a fresh machine may also need `npx playwright install --with-deps chromium`. The runner starts an isolated loopback server and a fresh headless browser together, invokes the seven offline checks and tests live transport, Now/Next, crossfade, duplicate-tab ownership, replacement, reload and responsive layout. It saves JSON reports and screenshots under ignored `artifacts/s02-browser/` and exits nonzero on failure. `--browser PATH` optionally selects an already installed Chromium binary. CI runs this browser check alongside Node checks and uploads evidence per OS. Headless output is not physical listening.

## Files

| File | Responsibility |
| --- | --- |
| `src/browser-pack.ts` | Bounded browser loading, media/provenance validation and native decoding. |
| `src/web-audio.ts` | One clock, checked route planning, and the recorded `PlayableSource` implementation. |
| `src/player.ts` | Small A/B transport, cancellation, context lifecycle and renderer-derived state. |
| `web/app.ts`, `web/index.html`, `web/style.css` | Minimal controls, same-origin tab ownership and presentation. |
| `web/checks.ts`, `web/checks.html` | Reproducible native offline-render checks. |
| `scripts/serve.ts` | Portable loopback-only static demo server. |
| `scripts/browser-check.ts` | Isolated native browser verification and evidence capture. |

## Upstream mechanism references

Checked 2026-11-04. These document browser mechanisms; this repository's implementation evidence is recorded separately.

- [W3C Web Audio](https://www.w3.org/TR/webaudio/) — scheduled buffer starts and audio-parameter automation.
- [AudioContext suspend](https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/suspend) — suspension stops the progression of the context's time.
- [Buffer-source start and offset](https://developer.mozilla.org/en-US/docs/Web/API/AudioBufferSourceNode/start) — absolute context time and buffer offsets; each source node starts once.
- [W3C Web Locks](https://www.w3.org/TR/web-locks/) — origin-scoped ownership held for the callback promise; `ifAvailable` fails without queueing a later takeover.
- [Playwright CI](https://playwright.dev/docs/ci) — reproducible browser installation and automated checks; Playwright is a development dependency only.
