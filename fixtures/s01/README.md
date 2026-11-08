# EMF-S01 fixture pack

This is a small self-contained `em.audio-pack.v0` pack: two original finite
recordings, four reusable original sample inputs, one palette, one metadata-only
recipe reference, and one directed fixture route. All audio is 24 kHz mono
PCM16 WAV; no external content or plugins are needed.

| Asset | Frames | Duration | Purpose |
| --- | ---: | ---: | --- |
| `s01-recording-a` | 384,000 | 16 s | Eight-bar triangle arrangement |
| `s01-recording-b` | 384,000 | 16 s | Distinct eight-bar syncopated arrangement |
| `s01-kick` | 6,000 | 0.25 s | Original drum input |
| `s01-percussion` | 1,800 | 0.075 s | Original seeded percussion input |
| `s01-bass-a2` | 9,000 | 0.375 s | Original A2 bass input |
| `s01-harmony-am` | 24,000 | 1 s | Original A minor chord input |

Both recordings use 120 BPM, 4/4, static A minor pitch classes `[0, 4, 9]`,
eight bars, and four-bar phrases. The A-to-B route starts at A quarter 16 and B
quarter 0, with an eight-quarter overlap. Entry, transition exit, and finite-end
cues occur at quarters 0, 16, and 32. This is structural compatibility evidence;
there has been no listening approval.

From the repository root, on Windows, macOS, or Linux with Node 24 or newer:

```text
npm ci --ignore-scripts
npm run fixtures:check
npm run validate
```

`npm run fixtures:generate` deterministically rewrites the committed WAV files
and manifest. `node dist/scripts/generate-fixtures.js --check` is read-only and
uses the repository fixture directory independently of the current working
directory. An optional final argument selects another output/check directory.
No shell utilities, audio hardware, FL Studio, or services are needed.

An alternate output directory receives media and the manifest only. Copy
`PROVENANCE.md` alongside that manifest before using the directory as a standalone
pack; the validator requires its referenced rights evidence. The normal repository
pack already includes it.

See [PROVENANCE.md](PROVENANCE.md) for fixture-only CC0 licensing, construction,
seed, and limitations. Exact audio hashes and all asset/cue/palette references
are recorded in [manifest.json](manifest.json).
