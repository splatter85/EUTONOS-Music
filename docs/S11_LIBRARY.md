# S11 — local library, saved recipes and three recipe studies

Document ID: `EM-D027`  
Scope: first increment of `EMF-S11`, `campaign-emf-001`. The [campaign](campaigns/EMF_INITIAL_INFRASTRUCTURE.md) owns status; the [handoff](handoffs/EMF-S11-HANDOFF.md) records the exact tested source and checks.

S11 adds the first post-proof breadth: a small versioned **music library** that remembers packs, saved "vibes" (exact recipe selections), volume/mute preferences and a bounded history of renderer observations, plus **three original recipe studies** that give the S04 performer structurally different rhythms. It is library code with tests and a command-line example. **The DJ and sampler pages do not use it yet**, and nothing here was listened to.

## Try it

```sh
npm run library:demo
npm run check:browser
```

1. `s11-library-demo` derives a study pack from the S01 fixture, saves one vibe per study in `local/s11-library/` (git-ignored; `--directory DIR` picks another), then restores each one **stopped** and prints its recipe, performer, seed and event count. It verifies the fixture WAVs and creates no audio.
2. `s11-browser-check` runs in headless Chromium on an ephemeral loopback port: IndexedDB save → real page reload → stopped restore with live audio blocked, two connections racing one compare-and-swap, malformed/future records preserved, and 24 offline renders (3 studies × 44.1/48 kHz × Explore/Drive × 2 seeds) each rendered twice and compared bit for bit. It writes `artifacts/s11-browser/report.json`.

Since 2026-11-08 both are in the standard gates: `npm run check` ends with the library demo in the ignored `artifacts/s11-library-check/` folder (it can run repeatedly, since re-saving the same data changes nothing), and `npm run check:browser` runs `s11-browser-check` after the main browser check. The S11 Node tests run under `npm test`.

## Library (`src/library.ts`)

One JSON snapshot, schema `em.music-library.v1`, at most 2 MiB:

| Part | Limit | Meaning |
| --- | --- | --- |
| `catalogue` | 16 packs | Exact pack metadata and its SHA-256. A pack id and revision can never be replaced by different metadata. Metadata is not proof that the media is installed or decodes. |
| `vibes` | 64 | A label plus a recipe replay (below). |
| `preferences` | — | Volume 0–1 and mute. |
| `history` | 256 newest | Renderer observations: `started`, `ended` or `stopped`, with engine generation and frame. Never a request, a schedule or a claim that anyone heard it. Older entries drop and are counted in `dropped_history`. |

Every write names the revision it expects and goes through the storage's compare-and-swap of the whole previous snapshot. A stale revision or a second writer gets a `conflict` error; nothing is merged or silently overwritten. Invalid JSON, a future schema, an oversized file or a digest mismatch is refused and the original bytes are kept, never reset.

`restore(id)` returns the vibe and preferences with `transport: 'stopped'` and `requires_explicit_play: true`. It never creates an audio context or starts playback. `resolveVibe` recompiles the plan against the pack metadata the caller supplies now; callers still load and verify media before playing.

Two storage adapters:

- `FileLibraryStorage` (Node) writes `library.json` through a temporary file and rename, guarded by `library.lock`. An existing lock is never guessed stale or stolen; it needs inspection. If the rename succeeded but lock cleanup failed, the error says `reconcile`: re-read before retrying. Atomic rename covers normal interruption, not power loss.
- `IndexedDbLibraryStorage` (browser) keeps one record in one store and does the compare-and-swap inside a single transaction. There is no localStorage fallback.

## Recipe replay (`src/recipe-library.ts`)

A replay (`em.recipe-replay.v1`) pins the pack, recipe, palette and performer identities, the pack and plan SHA-256, the seed and the state. `resolveRecipeReplay` recompiles and refuses if any of those changed, including same-revision metadata edits. Fixture permission is not stored in the replay; the caller passes it each time.

`createRecipeStudyPack(pack, newIdentity, templateRecipe)` makes a new pack identity that keeps the source assets, paths and rights and adds the three studies cloned from the template. It refuses to reuse the source identity.

## Recipe studies (`src/phrase-plan.ts`)

| Recipe | Genre label | Description (from the recipe) |
| --- | --- | --- |
| `s11-open-space@1` | ambient-study | Sparse alternating bars with a four-bar response. In Explore, kick and bass rest on odd bars. |
| `s11-steady-pulse@1` | house-study | Four quarter-note anchors with offbeat bass and percussion. |
| `s11-broken-current@1` | broken-beat-study | Syncopated kick patterns and a changing bass response. |

All three are original, labelled `listening: not-tested`, and play through performer `s11-pattern-performer@1`. Other recipes, including S01, the S06 mock and the S09 FL recipe, keep `s04-s01-performer@1` and their original events. The hybrid policies require the S04 performer, so **the studies cannot be used as DJ bridges**; that needs its own policy.

Genre labels are starting vocabulary for tests, not claims about those genres.

## Limits

- Windows only (worker and coordinator). macOS and Linux were not run.
- Not wired into the DJ or sampler pages: no save button, no history writes from playback, no restored selection on load.
- No physical output and no listening. Bitwise replay and headroom checks say nothing about whether the studies sound good.
- No transition graph, coverage diagnosis or new hybrid policy; EMF13 is untouched.
