# EMF-S08 — PC FL Studio authoring through one MCP facade: handoff

**Campaign:** EMF / `campaign-emf-001`  
**Slice:** EMF-S08  
**Disposition:** COMPLETE for the assigned bounded scope (see limits)  
**Environment:** PC — Windows 11 Pro, FL Studio 26.1.7.5654 (Producer-class install, license values not read), Node 26.12.1 locally (Node 24 contract), Claude Code 2.1.318 (`claude -p`, Sonnet), codex-cli 0.166.0-alpha.6  
**Inspected base:** branch `work/emf-s08-fl-mcp-20261104`, fast-forwarded to main `25c26bf9d5c6d0c2352dc0ee8ebfe2ff958978ec` (S02 closeout). Intake revision for the assignment: `43b7f44`.  
**Publication:** this file ships in the S08 closeout commit; the containing SHA and merge readback are reported in the chat mini handoff (a commit cannot cite itself).

## Assignment and scope

Prove the first real FL Studio authoring path through **one** EUTONOS Music MCP facade used by both Claude Code and Codex: discover, inspect, prepare, apply, verify, save, render, verify export, reconcile by caller operation ID and recover from backups. Acceptance: an original ~8-bar, 120 BPM, 4/4, A-minor sketch with drums, bass, harmony and melody, written by Claude Code through MCP into a disposable FL project, read back, saved, rendered to WAV and packaged as a real `em.audio-pack.v0` pack that the S01 loader accepts. Codex must connect to the same facade, inspect without conflict and make a bounded edit. Failure cases were required.

Excluded: DJ, player, generator and Mission Control integration; live GUI scripting or raw GUI automation for agents; any user project, preset or setting; publishing audio.

## Delivered changes

| Path | Effect |
| --- | --- |
| `src/authoring/broker.ts` | The single writer: workspace layout, writer lease, per-project lock, FL-CLI host lock, journal with caller operation IDs, prepare/apply with deterministic replan and SHA-256 revisions, backups, file and FL-side readback, save, render, export checks, pack builder, reconcile for every operation kind, restore |
| `src/authoring/flp.ts` | Clean-room FLP codec: events, channels, patterns, notes, tempo, playlist clips; writes only the verified FL 24.x layout |
| `src/authoring/smf.ts` | Standard MIDI file reader for FL's MIDI export |
| `src/authoring/host.ts`, `host-windows.ts` | Host adapter boundary; Windows adapter (FL64 discovery, `/M` MIDI export, `/R /Ewav` render, process check, template allowlist). Other platforms get `UnsupportedHost` |
| `src/authoring/mcp-server.ts`, `mcp-main.ts`, `schema.ts` | Dependency-free stdio MCP server (protocols 2024-11-05 … 2025-11-25), 16 tools with annotations, schema-checked arguments, `<workspace>` path redaction |
| `src/authoring/errors.ts` | Stable error codes |
| `tests/authoring.test.ts` | 12 tests over a synthetic, non-proprietary FLP and a fake host (no FL needed in CI) |
| `.mcp.json`, `.codex/config.toml` | In-repo registrations for Claude Code and Codex; nothing written to user-level config |
| `docs/S08_FL_AUTHORING.md` | Operating guide (EM-D020) |
| `docs/evidence/emf-s08/` | Scrubbed live evidence (tool transcripts, journal, render record, pack manifest and provenance) |
| `docs/DECISIONS.md` | EM-DEC025 (offline project authoring + FL CLI route), EM-DEC026 (shared-workspace coordination) |
| Status lines in `FL_AGENT_CONTROL.md`, `FL_STUDIO_INTEGRATION.md`, indexes in `README.md`, `docs/README.md`, `AGENTS.md` | Point to the implemented slice |

Owner-local, **not committed**: the workspace under `%LOCALAPPDATA%\EUTONOS-Music\workspace` with the acceptance project `emf-s08-acceptance`, its backups, renders and the pack `emf-s08-a-minor-sketch`.

## Verification and limits

| Check | Result | Evidence / limit |
| --- | --- | --- |
| `npm ci --ignore-scripts`, `npm run check` | PASS — 66 tests (54 earlier + 12 S08), fixture regeneration and pack validation PASS | Windows, local. CI not re-run for this branch at the time of writing |
| Claude Code acceptance via MCP | PASS | Created from the FL factory template, wrote 221 notes on 4 channels (Chords 48, Bass 40, Lead 31, Drums 102), tempo 120, 8-bar clips; revision `9ebc53e6…`, identical to an independent direct run |
| FL-side readback (`fl_verify`) | PASS | FL loaded the saved project and exported MIDI; every note (key, start, length, velocity) and the tempo matched per channel. FL shortens notes that end exactly at the song end by one tick; this is modelled and counted |
| Render + export check | PASS | FL CLI render ~7 s: PCM16 stereo 44.1 kHz, 881,311 frames (19.98 s, covers the 705,600-frame body plus tail), peak 0.986, first onset frame 2. WAV SHA-256 `2a931b4b…`. A later render of the same revision produced a different hash (`199dada2…`) with identical length and checks: FL renders are not byte-reproducible |
| Pack | PASS | `emf-s08-a-minor-sketch`, 8 bars, phrase 4, validated by the unchanged S01 `loadPack`. Rights: owner-local playback only, eligibility `unreviewed` |
| Codex on the same facade | PASS | Read the repo `.codex/config.toml`; inspected while Claude held the lease; edit refused with `LEASE_CONFLICT`; after expiry made a bounded edit (one Lead note 76→81) with FL-side verify; later restored to `9ebc53e6…` |
| Live failure cases | PASS | `OPERATION_ID_CONFLICT`, `HOST_BUSY` (render, verify, restore with FL GUI open), `UNKNOWN_PROJECT`, `TARGET_MISMATCH`, `TARGET_CHANGED`, status reconcile, stale restore refused, restore + replay, verify after restore |
| Unit-test-only failure cases | PASS (simulated) | Uncertain outcome via fault injection, failed save, missing/silent/short/tampered WAV, invalid pack metadata, FL unavailable, torn journal tail, dead-owner lock, interrupted create/save/pack reconcile, fail-closed FL process check, schema rejection, path redaction |
| Re-check after review fixes | PASS | Claude Code through the updated `.mcp.json`: verify true, render ok, export ok, status completed; commands show `<workspace>/…` |
| Physical playback / listening | **NOT TESTED** | Nobody has listened to any S08 render. Machine checks do not establish musical quality |

## Decisions, risks and recovery

- **Route (EM-DEC025):** offline project edits plus FL's own CLI. Live GUI control is reported unsupported: controller scripts need a MIDI input port and WinMM shows none on this PC. A virtual port would be a separately declared install.
- **Coordination (EM-DEC026):** each client launches its own server process; the shared workspace carries the lease, locks and journal. A running FL GUI counts as a competing writer.
- **Layouts:** projects re-saved by FL 2026 use a newer layout and are read-only to the broker.
- **Independent code review** (KEEP/CHANGE/DEFER) found 15 CHANGE items; all were fixed before closeout: argument schema checks (an out-of-range `phrase_bars` could hang the server), torn journal tail handling, stale-lock recovery, reconcile under the lock and for every operation kind, unique render folders plus a host-wide FL lock, honest `verified`/save/origin wording, lease checked inside the lock, tick bounds and tick-exact readback, fail-closed FL detection, failures replaying as errors, exclusive create, Windows reserved names, rename retry, and the status tool's annotation. DEFERRED: owner-confirmed lease takeover after a client restart (lease TTL default 900 s), JSON-RPC batches, FL discovery outside `C:\Program Files` and for FL 20/21, SMF reader edge cases, multiple notes events per pattern, and pruning `prepared/` and `verify/` folders.
- **Rights:** Image-Line support states built-in sounds may be used in your own compositions but not redistributed as sample packs. S08 packs stay owner-local and are never committed.
- **Platforms:** Windows only for FL. macOS has no documented FL CLI; Linux runs FL only under Wine. Elsewhere the server runs with an unsupported host (inspect and offline edits work; verify/render return `UNSUPPORTED_CAPABILITY`).
- **Last verified state:** project `emf-s08-acceptance` at `9ebc53e64350d18d0c226926a8b4a2e8014318ca346117e8240e7bdec847f8f2`; pack `emf-s08-a-minor-sketch` valid; FL Studio closed.
- **Recovery:** `fl_operation_status` for any uncertain ID; `fl_list_backups` + `fl_restore` for any earlier revision.

## Next handoff

**Exactly one next actionable slice:** EMF-S03 — CLOUD (deterministic DJ and request integration), unchanged by S08.  
**Prerequisites:** current main, Node 24, the S02 handoff.  
**First command/action:** inspect main, then `npm ci --ignore-scripts` and `npm run check`.  
**Owner action:** approve the `eutonos-music` project MCP server once in an interactive Claude Code session (Codex already reads the repo config while the project is trusted). Optionally listen to the owner-local render in the workspace; that listening is not part of S08 acceptance.  
**Still not done:** listening, S09 import of FL output into the cloud build (needs S05–S06), live GUI control, mixer/plugin edits, render settings, stems.

## Closeout

Campaign checkpoint and Current Tasks are updated in the same change. The chat mini handoff carries the verified containing commit and merge readback.
