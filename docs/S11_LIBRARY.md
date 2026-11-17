# S11 — local library, saved recipes and breadth studies

Document ID: `EM-D027`  
Scope: first increment of `EMF-S11` / `campaign-emf-001`, plus its separately assigned S22 / EMF-S11 items 3–4 breadth work. The [campaign](campaigns/EMF_INITIAL_INFRASTRUCTURE.md) owns status; the [historical first-increment handoff](handoffs/EMF-S11-HANDOFF.md) remains an as-of record.

The first increment added a local versioned **music library**, exact recipe replay, renderer-observation history and three original recipe studies. S22 adds five more original declarative rhythm studies, a specific S05/S09 hybrid refusal for all studies, EMF12 recency advice and an EMF13 transition-graph coverage report. **No page wiring or playback-history capture was added.** No sample was heard or granted listening approval.

## Try it

```sh
npm install
npm run library:demo
npm run check
npm run check:browser
```

1. `s11-library-demo` verifies the original S01 fixture WAVs and registers a separate breadth pack (`s11-original-breadth@1`) containing eight studies. It saves `breadth-s11-*` vibes, restores them **stopped**, then prints seed, performer, event counts, a deterministic next-vibe suggestion, and a directed coverage report with missing genre/style pairs and reasons. The default snapshot is in git-ignored `local/s11-library/`; `--directory DIR` selects another. Existing three-study pack identity and saved vibe IDs are not overwritten. No playback or observation is added.
2. `s11-browser-check` exercises IndexedDB save → actual page reload → stopped restore with live audio blocked, competing compare-and-swap writers and preservation of invalid/future data. It also renders the **eight-recipe breadth pack** at 44.1/48 kHz, Explore/Drive and two seeds: 64 native cases, each rendered twice for sample-by-sample replay, peak bounds and resource release. The S11 browser report is written to ignored `artifacts/s11-browser/report.json`.
3. The Node suite covers exact legacy three-study replay, seed/state/role limits for all eight studies, the hybrid refusal and unchanged S05 route, EMF12 selection/fallback and EMF13 declared candidate/missing-edge classification. The native render and the graph are engineering checks only.

Both S11 commands are in the normal npm gates: `npm run check` ends with the library demo in ignored `artifacts/s11-library-check/`, and `npm run check:browser` runs the S11 browser check. Other browser and transition checks remain owned by their existing stages.

## Library (`src/library.ts`)

One JSON snapshot, schema `em.music-library.v1`, at most 2 MiB. S22 does **not** change the schema, limits, compare-and-swap semantics or saved record layout.

| Part | Limit | Meaning |
| --- | --- | --- |
| `catalogue` | 16 packs | Exact pack metadata and SHA-256. Same pack identity/revision cannot be replaced with different metadata. It is not proof that media exists or decodes. |
| `vibes` | 64 | A saved label and exact recipe replay. |
| `preferences` | — | Volume 0–1 and mute. |
| `history` | 256 newest | Renderer observations: `started`, `ended`, `stopped`; each has a playback ID, engine generation and frame. Not a DJ request or evidence of a listener hearing audio. Older entries drop with a count. |

Every write supplies the expected revision and compare-and-swaps the whole snapshot. Stale writes conflict; malformed, future-schema, oversized or digest-mismatched snapshots retain their original bytes. `restore(id)` returns `transport: 'stopped'` and `requires_explicit_play: true`. `resolveVibe` recompiles the exact plan against current supplied pack metadata, but does not load or play audio.

`FileLibraryStorage` (Node) uses an exclusive lock and temporary-file rename; uncertain cleanup requires reconciliation. `IndexedDbLibraryStorage` performs the compare-and-swap in a single transaction, with no localStorage fallback. Neither adapter changed for S22.

## Exact recipe replay and the version boundary

A replay (`em.recipe-replay.v1`) pins pack/recipe/palette/performer, the pack and compiled-plan SHA-256, seed and state. Resolving recompiles and refuses any metadata or symbolic-event drift. Fixture permission is never retained.

- `createRecipeStudyPack(source, identity, template)` still derives exactly the **original three** study recipes. The resulting old manifest and historical replay digests remain compatible. Existing identifiers are not repurposed.
- `createRecipeBreadthPack(source, newIdentity, template)` derives a **new eight-study pack identity**, preserving the original source assets, paths, usage rights and routes. The demo uses `s11-original-breadth@1`; it does not mutate `s11-original-studies@1`.
- Every study uses `s11-pattern-performer@1` and the existing bounded, compiled event rules. Recipe, groove and transition tags are **plain, frozen declarative data**, not scripts, callbacks or executable instructions. Unrecognized/legacy recipes still use `s04-s01-performer@1`.

## Eight original rhythm studies (`src/phrase-plan.ts`)

All use the existing 120 BPM, 4/4, eight-bar test-performer contract and the supplied authorized palette. Genre names are *study labels*, not cultural definitions or listening-quality claims. Every entry is labelled `listening: not-tested`.

| Recipe @1 | Genre label | Declarative arrangement concept | Style tag |
| --- | --- | --- | --- |
| `s11-open-space` | ambient-study | Sparse alternating bars; odd-bar rests in Explore | space |
| `s11-steady-pulse` | house-study | Four quarter-note anchors and offbeat accents | pulse |
| `s11-broken-current` | broken-beat-study | Syncopated kicks and responsive bass | break |
| `s11-downtempo-drift` | downtempo-study | Half-time anchors and spacious offbeats | half-time |
| `s11-electro-sparks` | electro-study | Staggered accents and syncopated bass | break |
| `s11-garage-steps` | garage-study | Offset kick answers and quick percussion | swing |
| `s11-minimal-circuit` | minimal-techno-study | Repeated quarter pulses and restrained bass | pulse |
| `s11-cinematic-wake` | cinematic-study | Separated accents and alternate-bar responses | space |

These original, invented rhythmic sketches use only source samples already licensed under the existing fixture contract. No third-party loops, MIDI phrases, proprietary audio or new media assets were added.

## Item 3: explicit S05/S09 hybrid refusal

`planHybridHandoff` now **explicitly refuses** any S11 study recipe or `s11-pattern-performer`, before scheduling, with this reason:

> S11 study recipes cannot act as hybrid bridges: no study-specific percussion-only lead-in/tail policy or listening review exists.

The S05/S09 hybrid policy is bound to specific original recipe/performer/route identities and narrow percussion-only windows as the recorded source fades and B enters. Matching BPM/key or reusing the same samples does not validate the new study arrangements as bridges. Existing S05, S06 and S09 policies are unchanged; the original S05 path still passes. The refusal is deliberately conservative and covered by tests for both phrase and end exits.

## Item 4: EMF12 recency / avoid-repeat

`selectNextVibe(snapshot, lookback = 8)` in `src/library-breadth.ts` returns **advice only** for automatic selection; it does not mutate a library, start playback or alter manual choices. It scans the newest distinct `started` renderer observations (bounded to 1–32) and compares **recipe id + revision**, irrespective of saved vibe name, seed or state. Ends/stops and duplicate playback IDs do not create extra plays. Retained starts are ordered by their canonical UTC `observed_at` timestamp, newest first, rather than by when a write arrived. Equal timestamps use ascending observation IDs as a deterministic tie-break, independent of arrival order; duplicate playback IDs are removed after sorting and before applying the lookback. The persisted history is never reordered. This cannot repair inaccurate source clocks or recover pruned observations.

Unseen recipes within that window rank first. If every candidate recently started, it chooses the least recently started rather than refusing all music. Ties use a stable saved-vibe ID order. The result says whether it found no start history, a candidate outside the window or a least-recent fallback. Since pages are not yet capturing playback into S11 history, an empty history cannot supply useful personalization. This is not a three-day variety guarantee.

## Item 4: EMF13 directed transition-graph coverage

`reportTransitionCoverage(snapshot)` scans registered library pack **recipe metadata**, grouping genre/style labels, evaluating at most the first 32 nodes in stable genre/style order. Larger valid libraries return a **partial report**, not an exception. It reports evaluated directed pairs as `metadata-candidate` or `gap`, the count of each and explicit missing-pair reasons. A candidate requires:

- both source and destination to have a declared S11 style, with the source style's data-only `transitionTo` list naming the destination style;
- equal declared tempo, meter, key and harmony pitch classes.

Missing style declarations, incompatible tempo/meter, unasserted/mismatched harmony and omitted style handoffs become visible gaps. Unprofiled S01/producer recipes are **unknown**, never silently approved. Direction matters: a source-to-target candidate does not imply the reverse.

The report and command-line demo expose `complete`, `node_limit`, `total_nodes`, `omitted_nodes`, `possible_pairs` and `unevaluated_pairs`. `total_pairs` still counts only evaluated pairs, and equals `metadata_candidates + gaps`. `possible_pairs` covers every directed non-self pair in the full library; `unevaluated_pairs = possible_pairs - total_pairs`. Omitted pairs are **unknown, not gaps or candidates**. For example, 36 nodes yield 32 evaluated nodes, 992 evaluated pairs and 268 unevaluated pairs out of 1,260, with `complete: false`. A library of 32 or fewer nodes is reported completely.

The review regressions cover the 0/1/32/33/36-node boundaries, deterministic ordering, delayed starts, tied timestamps, duplicate playback observations and the actual command-line path on a larger saved library.

**A candidate is NOT a validated DJ route.** This graph does not inspect cue placement, prepared audio, mix safety, actual source availability or audience acceptance. It supplies coverage diagnostics, not transition authorization or a score of musical quality. The demo prints the missing genre/style pairs; no scheduler or page consumes this report.

## Limits and handback

- Windows is the implementation/verification target. macOS and Linux were **NOT RUN** for S22.
- No physical audio output, listening, real-device transition acceptance or FL Studio authoring was tested. Offline signal equality and peak bounds cannot prove that a recipe sounds good.
- No page wiring, current playback-history capture, automatic DJ selection or additional route permissions were added. This narrow branch changes only library/recipe source, S05 preflight, S11 demo/browser checks, tests and this document.
- The first-increment handoff remains historical. Stage status, boards, CURRENT_TASKS, RAM, NAV, campaigns and main integration are deliberately left to the coordinator under this branch-only assignment.
