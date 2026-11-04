# EMF-S08 evidence

Recorded 2026-11-04 on the owner's Windows 11 PC with FL Studio 26.1.7.5654. Local paths and user names are replaced with `<workspace>` / `<home>`. Note lists are trimmed to counts. No audio, FL project or pack audio is committed: the render uses FL factory instruments, whose redistribution is not established.

| File | What it shows |
| --- | --- |
| [live-runs.json](live-runs.json) | Every MCP tool call and result from eight recorded client sessions: Claude Code acceptance (create → edit → readback → save → render → pack), the lease and duplicate-ID run, three Codex runs (inspect under Claude's lease, `LEASE_CONFLICT`, bounded edit after expiry), the FL-GUI-open refusals, wrong-target / stale-revision / reconcile / restore, and a re-check after the review fixes |
| [journal.json](journal.json) | The acceptance project's operation journal (results omitted): who did what, under which operation ID, with before/after revisions |
| [render.json](render.json) | The acceptance render record: FL version, CLI command, duration, WAV hash, format, frames, peak and onset |
| [pack-manifest.json](pack-manifest.json) | The `em.audio-pack.v0` manifest built from that render and validated with the S01 loader |
| [pack-PROVENANCE.md](pack-PROVENANCE.md) | The pack's provenance note: which notes the facade wrote, instruments, render command and rights limits |

The acceptance pack was built before the review fixes; its `rights.origin` wording predates the conditional "mixed" wording and is accurate here, since every arranged note was written through the facade. Nobody has listened to the render.

Regenerate from the workspace with the scratch script used in the session (not committed); the files are snapshots, not live state.
