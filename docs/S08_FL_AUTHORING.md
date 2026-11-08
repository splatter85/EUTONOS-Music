# S08 — FL Studio authoring through one MCP facade

Document ID: `EM-D020`
Status: implemented and live-verified on the Windows reference PC, 2026-11-04 (EMF-S08). Contract `em.fl-authoring.v0`, bridge 0.1.0.

## What it is

`eutonos-music` is a dependency-free stdio MCP server (`src/authoring/`). **Claude Code and Codex launch the same server code, and every server process works through one broker over one private workspace.** The broker coordinates processes through a writer lease, a short per-project critical-section lock, a workspace-wide lock that runs one FL CLI job at a time, and an operation journal keyed by caller-chosen operation IDs. Agents pass validated IDs, never filesystem paths, scripts or GUI actions. Every tool argument is checked against the tool's JSON schema before any broker code runs, and local paths in results and errors are shown as `<workspace>`.

The verified route is **offline project authoring plus FL Studio's own command line**:

1. A disposable project is copied from an allowlisted FL factory template into the workspace. User projects are never touched.
2. The broker edits the saved `.flp` with a clean-room codec (`flp.ts`). It can replace one channel's notes inside a named pattern, set the tempo, and resize the playlist clips of the edited patterns.
3. **Readback happens twice.**
   - The persisted file is re-parsed.
   - FL Studio itself loads the saved project (`FL64.exe /M`) and exports MIDI. Every song-time note (key, start, length, velocity) and the tempo are compared per channel.
4. FL Studio renders WAV with `FL64.exe /R /Ewav`. The WAV is checked (PCM16, long enough for the arrangement, not silent, not clipped at full scale) and then packaged as an `em.audio-pack.v0` pack. The pack is validated with the unchanged S01 loader.

Live editing inside a running FL GUI is **not supported** on this host; it is reported as unsupported, not simulated. The controller-script route needs a MIDI input port, and WinMM sees none here. A virtual port (loopMIDI or a WinMM-visible Windows MIDI Services loopback) would be a later, separately declared install.

## Tools

| Tool | Effect |
| --- | --- |
| `fl_capabilities` | Contract, FL host availability/version, writer model, supported / partial / unsupported operations |
| `fl_list_projects`, `fl_inspect` | Read the saved project: revision (SHA-256), FL layout version, tempo, meter, channels, patterns (optionally notes), playlist clips, writer lease, and whether an FL window holds the project |
| `fl_create_project` | Copy an allowlisted factory template into the workspace |
| `fl_prepare_edit` | Dry run against an exact `expected_revision`. Targets name a pattern **and** a channel by index plus expected name. Returns `change_id` and the predicted `after_revision` |
| `fl_acquire_writer` / `fl_release_writer` | Single writer lease, 30–3600 s TTL |
| `fl_apply_edit` | Under the lease: journal `started` → back up the before-revision → atomic write → file readback → journal `completed` |
| `fl_verify` | FL-side readback through FL's MIDI export |
| `fl_save` | Named, hash-checked checkpoint copy of the editable project (FL-side readback is `fl_verify`) |
| `fl_render`, `fl_verify_export` | FL CLI WAV render plus checks; re-check later (hash, presence, source copy) |
| `fl_build_pack` | `em.audio-pack.v0` from a verified render. Rights stay owner-local playback; eligibility `unreviewed` |
| `fl_operation_status` | Reconcile by operation ID. For an operation that started without a recorded outcome it checks durable state — project revision for apply/restore, project files for create, checkpoint hash for save, `render.json` plus WAV checks for render, a valid pack with the same audio hash for pack — and records the outcome |
| `fl_list_backups`, `fl_restore` | Recover any backed-up revision. The replaced revision is backed up first |

**Retry rule:**

- The same operation ID with the same payload replays the recorded outcome.
- The same ID with a different payload returns `OPERATION_ID_CONFLICT`.
- An ID with a `started` record and no outcome returns `OUTCOME_UNKNOWN` until `fl_operation_status` reconciles it.
- A recorded **failure** replays as the same error (`isError`), never as success. Use a new ID to try again after fixing the cause, for example after closing FL.
- A lock left by a process that died is broken automatically (dead owner, or older than its limit). A torn final journal line from an interrupted append is moved to `journal.torn`; damage elsewhere stops with `JOURNAL_CORRUPT`.

**Stable error codes** are listed in `src/authoring/errors.ts`, for example `TARGET_CHANGED`, `TARGET_MISMATCH`, `LEASE_CONFLICT`, `HOST_BUSY` and `EXPORT_INVALID`.

## Setup and registration (declared in this repository)

Prerequisites: Node 24 or newer, `npm ci --ignore-scripts`, `npm run build`, and FL Studio installed. The adapter finds `C:\Program Files\Image-Line\FL Studio <year>\FL64.exe`; override it with `EUTONOS_FL_EXE`.

**Workspace:**

- Default: `%LOCALAPPDATA%\EUTONOS-Music\workspace` on Windows, `~/Library/Application Support/EUTONOS-Music/workspace` on macOS, `$XDG_DATA_HOME/eutonos-music/workspace` on Linux.
- Override with `EUTONOS_MUSIC_WORKSPACE`.
- The workspace holds the projects, renders and packs. It is owner-local and never committed.

Both registrations live **in this repository**; nothing is written to user-level config.

- **Claude Code:** [`.mcp.json`](../.mcp.json) declares `eutonos-music` (`node ${CLAUDE_PROJECT_DIR:-.}/dist/src/authoring/mcp-main.js`).
  - Interactive sessions ask the owner once to approve this project server.
  - For a non-interactive run without persistent approval: `claude -p --strict-mcp-config --mcp-config .mcp.json --allowedTools mcp__eutonos-music`.
- **Codex:** [`.codex/config.toml`](../.codex/config.toml) declares `[mcp_servers.eutonos_music]` with `tool_timeout_sec = 420` (up to 60 s waiting for another client's FL job plus the 300 s FL CLI limit). Codex reads it only while this repository is a trusted Codex project.
  - Verified with codex-cli 0.166: `codex mcp list` shows `eutonos_music` from the repository directory, and `codex exec --sandbox read-only` used it.

The Codex entry uses a relative path, so start Codex from the repository root. Claude Code resolves the path from `CLAUDE_PROJECT_DIR`.

## Host behavior observed (FL Studio 26.1.7.5654, Windows 11)

- **CLI timing:** a render takes about 7 s and a MIDI export a few seconds, both exit 0. The output lands beside the project as `<stem>.wav` or `<stem>.mid`. Render format is PCM16 stereo 44.1 kHz with no CLI control over the format.
- **Running instance:** if any FL GUI instance is running, the CLI exits 0 in about 1 s and **writes nothing**. The adapter therefore refuses with `HOST_BUSY` before calling it.
- **Window detection:** `fl_inspect` reports a window that holds the project by name; apply and restore also refuse in that case. If the process check itself fails, the broker treats FL as busy.
- **MIDI export trim:** FL's MIDI export ends a note that reaches the song end one tick early. `fl_verify` models and reports this convention (`notes_ending_at_song_end_exported_one_tick_short`); every other field must match exactly.
- **Layout versions:**
  - FL 2026 opens and renders FL 24.x-layout projects written by the broker.
  - Projects re-saved by FL 2026 use a newer event layout. Third-party reports say FL 26 uses 88-byte playlist records and a 1-byte event 172.
  - The broker therefore **writes only the verified 24.x layout** and treats other layouts as read-only.

## Limits

- No live GUI editing, channel/plugin creation, mixer, automation or plugin-parameter edits. No render settings or stems.
- Only untrimmed pattern clips can be resized.
- Windows adapter only. On macOS and Linux the server runs with an `unsupported` host: inspection and offline edits work, render and verify report `UNSUPPORTED_CAPABILITY`. No official FL CLI was found for macOS, and FL has no native Linux build.
- **Rights:** renders use FL factory instruments. Image-Line support states that built-in sounds may be used in your own compositions but not isolated or redistributed as sample packs. EMF-S08 packs therefore stay `allowed_uses: ["playback"]`, owner-local and `unreviewed`. They are never committed or published.
- Machine checks do not establish musical quality. **Nobody has listened** to the S08 render as part of this slice.
- [S06](S06_IMPORT.md) drives this broker with a mock host for contract tests; that is not FL evidence. Because S08 renders are playback-only, they can enter a pack as recordings but not as palette samples, which need sample-reuse rights.
