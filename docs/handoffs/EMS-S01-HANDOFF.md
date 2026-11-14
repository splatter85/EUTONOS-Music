# EMS-S01 — rated-takes export handoff

**Campaign:** EMS / `campaign-ems-001`  
**Slice:** EMS-S01  
**Disposition:** COMPLETE (engineering scope); full gates passed; coordinator Music integration/readback next  
**Environment:** PC, Windows 11, Node v26.13.0, Chromium 151.0.7922.34; Windows only  
**Music inspected source / branch:** `8e3147814eeb2c2254a1d2c96232a60ad520a40f` / `work/rated-takes-20261114`  
**Exporter source:** `8b145c218fd776c0fda8505edae9926a398ed064`, integrated into owner-local main; target clean and 18 tests passed  
**Publication/integration:** exporter local target integration verified; Music local main integration pending. No public Git publication performed.

## Assignment and delivered changes

The owner assigned a bulk snapshot of every rated Music Studio take and its EMF-S16 intake, with status reconciliation. The exporter is owner-local code outside this public repository. It writes an immutable new root `music-studio.rated-export.v1` and `love`, `like`, `dislike` manifests using `music-studio.rated-set.v1`. Every rated take keeps its full original PCM24 audio, original recipe bytes, full-length PCM16 audition and hashes/byte counts. Existing outputs are refused; ratings and source takes are preserved.

EUTONOS Studio offers **Export all rated takes**, separately labelled from individual export. Catalogue/intake, explicit audition and shared playback ownership are the paired [EMF-S16 delivery](EMF-S16-HANDOFF.md). No take IDs, titles, private machine paths or generated audio are included in Git. [Contract and commands](../S16_RATED_TAKES.md).

## Verification and limits

Evidence below is coordinator-reported executed evidence for this slice, not a listening judgment.

| Check | Result | Scope |
| --- | --- | --- |
| `.venv/Scripts/python.exe -m unittest discover -s tests -v` (owner-local app) | 18 tests passed | Exporter source `8b145c218fd776c0fda8505edae9926a398ed064`; Windows only |
| `.venv/Scripts/python.exe -m studio.export_rated --out EXPORT_ROOT` | Actual snapshot: 43 takes, 3 love / 6 like / 34 dislike | Fresh owner-local directory; ratings unchanged; full originals, raw recipes and PCM16 auditions retained |
| Independent export hash/byte verification | All 129 files matched; 2,244,119,339 bytes | Private export contents remain outside Git |
| `node dist/scripts/import-rated-takes.js --source EXPORT_ROOT --out local/s16-rated --pair TAKE_A TAKE_B` | Actual intake: all 43 takes plus explicit two-love-take audition | Both selected takes request 128 BPM; 63,504,088 total audition-audio bytes; requested tempo is not a measured grid |
| Synthetic Studio browser check | 13 checks passed | Includes explicit local unreviewed pair, direct-only handoff, default-load refusal, negative-inventory separation and shared preview/DJ playback ownership |
| Server check | 7 tests passed | Bounded owner-local rated catalogue/pack routes |
| Independent final review | KEEP after fixes | Corrected first-A ordering, rated transition controls and cross-tab preview ownership; no broader acceptance implied |
| `npm.cmd run check` | PASS, exit 0: 421 Node tests | Source `8e3147814eeb2c2254a1d2c96232a60ad520a40f`; fixtures/media validation and S11 demo passed |
| `npm.cmd run check:browser` | PASS, exit 0, reports without errors | 24 native offline + 16 browser checks; 4 S11 groups / 24 paired cases; 13 Studio checks; 21 mix browser results |
| Actual private-pack page load | PASS: 12 assertions | Both selected WAVs loaded (63,504,088 bytes), stopped clocks at zero; explicit Play enabled/direct selected; mix/bridge and sampler disabled; full inventory and selected unreviewed requested-grid pair shown; all HTML audio paused; zero page errors. No Play clicked or private audio played/heard |

The real export was exercised directly through the exporter CLI. The live export HTTP endpoint was **NOT EXERCISED**: the local generator service was absent and was not started. Browser endpoint checks used a fake service.

No new music generation or FL authoring was required. PCM16 audition copies were derived from existing owner-local takes; full source audio remains private. **Physical output and human listening: NOT TESTED. macOS/Linux: NOT RUN.** The snapshot/intake and synthetic browser observations establish engineering behavior, not musical quality, rights certification or owner acceptance.

## Decisions, risks and recovery

**Decided:** Ratings are taste labels only; preserve dislikes as negative examples and never promote them into an automatic playlist. Default eligibility stays strict. An explicit local pair remains unreviewed, with unknown harmony, and is restricted to a direct zero-overlap cut. The `em.audio-pack.v0` schema is unchanged; positive-overlap harmonic checks stay strict.

**Decided:** Requested constant tempo, 4/4 and a frame-zero downbeat are audition assumptions. Generated bars may drift. The cut can shorten the outgoing take and cut its tail; no seamlessness or harmonic compatibility is asserted. Rated mode disables unsupported mix/bridge and sampler controls.

**Decided:** Sort the selected A asset first so initial playback follows the explicit pair order. Generator take preview acquires the same cross-tab playback ownership as DJ/sampler playback and releases it on stop. Review covered both corrections.

Last verified checkpoint: actual snapshot and intake succeeded, bounded checks and independent review passed. On export/intake failure, inspect the reported error and choose a fresh output directory; never overwrite an existing snapshot. Preserve previous useful outputs before replacing the fixed ignored demo directory. See the [command guide](../S16_RATED_TAKES.md).

## Next handoff

**Exactly one next slice:** **EMF-S10 — PC + owner**, after target integration is verified; separately assigned listening session.

**Prerequisites:** checked integrated Music source, the private imported pack and existing FL-backed pack where applicable, normal audio output and the [listening scorecard](../S10_LISTENING_SCORECARD.md). FL and agents must be closed during the accepted playback demonstration.

**First action:** read [Current Tasks](../CURRENT_TASKS.md), then run `npm.cmd run demo` and open `http://127.0.0.1:4173/studio.html?pack=rated` for the rated-pair audition. Play explicitly and record what the owner hears; include the existing FL/procedural flow and S14 bass-swap comparison under S10's scope.

**Owner action:** listen and accept or revise the bounded standalone flow. S12 Mission Control waits for S10. S10 does not complete EMF19.

**Still not done:** Music target integration and readback, public Git publication, physical output/listening, macOS/Linux qualification and full MVP acceptance. No new install, deployment, restart or next-slice dispatch follows automatically.
