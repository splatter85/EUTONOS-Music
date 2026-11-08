# Local music generators for EUTONOS Music

Status: **research proposal complete; every generator, installation, render, physical output and owner listening test is NOT TESTED**.

Sources checked: **2026-11-08 UTC**. Target supplied by the owner: **Windows 11, RTX 5090 with 32 GB VRAM, 95 GB system RAM**. Repository baseline: `504376b18449b89ff6801cf2332600f2692f5d7e` (`main`); research branch: `work/generator-research`.

This is documentation only. It proposes future offline production, changes no playback or delivery schema, and does not activate or complete an EMF slice. The [product goal](../PRODUCT_GOAL.md), [first-playable boundary](../FIRST_PLAYABLE.md), [S06 contract](../S06_IMPORT.md), [S09 FL delivery](../S09_FL_IMPORT.md) and [current tasks](../CURRENT_TASKS.md) remain authoritative.

## Recommendation

**First candidate to audition: ACE-Step 1.5, with XL Turbo as the quality candidate for this GPU.** Its checked code and checkpoints use MIT, commercial output use is expressly permitted, and the official Windows route includes CUDA 12.8. The published XL configuration tiers include 24 GB for XL plus the 4B language model, making a 32 GB card a credible evaluation target. This is a compatibility and workflow recommendation, not a claim that it sounds best. [A1], [A2], [A4], [A6], [A7]

Start a future evaluation with the 2B Turbo checkpoint, batch size one, to establish a working baseline; compare XL Turbo on the same instrumental brief. Use **base or XL-base** when stem extraction, adding a part or accompaniment completion is needed: those capabilities are not shared by Turbo/SFT. Keep all candidates **NOT TESTED** until the owner hears the exact rendered files. [A1], [A5]

**Complement: SkyTNT MIDI Model through FL Studio** for explicit notes, harmony and independently rendered parts. **Specialist: Stable Audio Open Small** for short percussion/textures, conditional on its commercial license. YuE2 is a worthwhile later score-controlled song experiment if the operator's individual/company use fits its terms. MusicGen's noncommercial weights, uncertain legacy Magenta checkpoint rights and SongGeneration's restrictive/partly inaccessible evidence make them weaker production defaults. [P6], [P7], [S6], [Y2], [M2], [P3], [G1], [G2]

## How to read the comparison

- **Published** means an upstream claim or measurement, not a run on this computer. No 5090 speed or peak-memory result was measured. Unknown means not established in the checked official material; it does not prove that a community implementation is impossible.
- VRAM minima, model-weight sizes and measured runtime peaks are different quantities. System RAM can support offloading when implemented; it does not turn 32 GB VRAM into 127 GB VRAM. Reserve capacity for the desktop and FL Studio; begin with one offline job.
- Old CUDA/PyTorch pins are a separate risk from memory capacity. PyTorch introduced Blackwell support with 2.7/CUDA 12.8; that is context for qualifying a compatible runtime, not an instruction to replace the project's environment. No installed driver/runtime was qualified here. [T1]
- Code, main weights, codecs and reference encoders can have different licenses. A permissive software license is not an output-ownership guarantee. Rights to prompts, lyrics, reference recordings, voices and rendered instruments still matter; playback permission and reusable sample-pack permission are different evidence questions.
- “Cover” below means an explicitly documented cover/recreation workflow. Style conditioning, melody conditioning and continuation alone do not establish faithful covers. “Repaint” means editing a selected audio region; regenerating a whole song from an edited score is different.
- Installation routes are descriptions for a later authorized evaluation. Nothing was installed, cloned from upstream, downloaded as model/media, executed as inference, or auditioned.

## Code, weights and commercial output use

| Family / exact release | Code license | Checked weights / required codec | Commercial output position |
| --- | --- | --- | --- |
| ACE-Step 1.5 2B and 4B XL | MIT | MIT on main, XL Turbo and XL-base cards | Upstream explicitly allows commercial generated music. Preserve third-party input rights. [A1], [A2], [A3], [A4], [A5] |
| YuE v1, s1-7B / s2-1B | Apache-2.0, per legacy official release/card | Apache-2.0 on both official cards | Official v1 card permits commercial songs; attribution encouraged. Do not apply YuE2 terms retroactively. [Y5], [Y6], [Y7] |
| YuE2-3B | Apache-2.0 | CC-BY-NC 4.0 **plus additional individual-creator permission**, including YuE2 VAE variants | Individuals may monetize/license outputs, including to clients; companies using weights commercially require a separate agreement. Individual permission is not a company deployment license. [Y1], [Y2], [Y3] |
| Stable Audio Open 1.0 / Small | MIT, stable-audio-tools | Stability AI Community License, not MIT | Conditional commercial use: registration and revenue conditions below; output ownership only to the extent law permits. [S1], [S2], [S3], [S6] |
| MusicGen, including melody/stereo variants | MIT | CC-BY-NC 4.0 | Do not select for commercial model use without separate permission. This is not a claim that every generated waveform automatically inherits CC-BY-NC. [M1], [M2] |
| Magenta RealTime v1 / v2 | Apache-2.0 | CC-BY 4.0, plus card usage terms | Commercial use allowed subject to applicable terms; Google claims no rights in generated outputs. Weight attribution obligations and third-party rights remain. [R1], [R2], [R5] |
| DiffRhythm v1.2 | Apache-2.0 | Main DiT Apache-2.0; **required VAE uses Stability Community terms** | Evaluate the whole pipeline under the VAE's conditional commercial terms; not an all-Apache stack. [D1], [D2], [D3], [D4] |
| DiffRhythm2 | Apache-2.0 | Apache-2.0 in official release/card, with a new VAE | Commercial model use permitted; no separate blanket guarantee of output rights found. Do not transfer v1's VAE terms to v2 without inspecting the actual dependency set. [D6], [D7], [D8] |
| SongGeneration / LeVo | Custom Tencent research-only license | Same custom terms explicitly cover weights; current sources partly inaccessible | Commercial/production model use prohibited; no separate commercial-output grant established. [G1], [G2], [G3] |
| MusicVAE / GrooVAE / Performance RNN | Apache-2.0 in Magenta implementations | Separate hosted-checkpoint grant **not established** by checked checkpoint/readme pages | Code license alone is insufficient to clear pretrained-model commercial output use; hold pending weight-specific evidence. [P1], [P2], [P3], [P4], [P5] |
| SkyTNT MIDI Model, tv2o-medium | Apache-2.0 | Apache-2.0 on the official checkpoint card | Commercial model use permitted; no special output warranty found. FL instruments/soundfonts require their own rendering and sample-reuse rights. [P6], [P7] |

**Stability conditions used here:** the checked July 5, 2024 agreement requires commercial registration; licenses terminate if the user or affiliates, individually or together, exceed US$1 million annual revenue, regardless of where revenue originated, requiring another agreement. It assigns outputs to the user as against Stability only as law permits, applies its acceptable-use restrictions to outputs, and prohibits using them to build/improve other foundational generative models. These are actual checkpoint terms, not the simpler assumption “open weights means commercially unrestricted.” Small links to the same license; DiffRhythm v1's VAE carries a copy. [S2], [S6], [D4]

## Audio generators

### ACE-Step 1.5: 2B and XL

**Memory and speed.** The GPU guide describes 2B operation around 4 GB for diffusion only and 6 GB with the language model using constrained/offloaded configurations. For XL it lists at least 12 GB with int8/offload, 16 GB with offload, 20 GB without offload, and 24 GB with the 4B language model. **Source discrepancy:** the guide describes roughly 9 GB XL weights, while the XL cards describe roughly 18.8 GB BF16 weights. Neither establishes complete runtime peak; retain the discrepancy rather than promise a fit at every duration. [A6], [A4], [A5]

The family README advertises a full song below 2 seconds on A100 or 10 seconds on RTX 3090, without a sufficiently fixed duration/configuration for a controlled comparison. Do not apply that headline to XL or this 5090. XL Turbo uses eight steps; XL-base/SFT use a longer 50-step path; comparable XL wall-clock evidence was not found. [A1], [A4], [A5]

**Length and controls.** Published duration range is 10-600 seconds: useful for sections and full songs, but a “loop” prompt does not certify a seamless boundary. Generation, covers and regional repaint are documented across the family. Stem extraction, adding a layer (“lego”) and completion of accompaniment require base/XL-base; Turbo/SFT lack those operations. [A1], [A3], [A5]

**Windows route.** Prefer the official native uv/Python 3.11 or 3.12 setup or Windows portable package, CUDA 12.8 and supplied batch launchers. Community ComfyUI integrations are mentioned, but checkpoint/task parity was not established; do not make a wrapper the source of truth. First launch can fetch models, so no launcher was run. **Project fit:** broadest first audio-production candidate, with XL only retained if the owner's controlled listening comparison justifies it. [A1], [A7]

### YuE v1 and YuE2: separate releases and licenses

**YuE v1.** The historical official guide limits cards at or below 24 GB to two sections and recommends 80 GB for four or more sections. A 32 GB card is a candidate for short, staged trials, not a verified unrestricted full-song configuration. Published RTX 4090 time is about 360 seconds for 30 seconds of audio (H800: about 150 seconds). This slow autoregressive result belongs to v1, not YuE2. Songs can span multiple verse/chorus sections and produce vocal/accompaniment streams; that is not arbitrary instrument-stem separation. In-context audio prompting uses the appropriate ICL checkpoint and supplies style/reference conditioning, not guaranteed faithful covers. No regional waveform repaint was verified. [Y7]

The legacy native guide is Linux-oriented; its official card links community Pinokio and YuE-for-Windows/Gradio-Docker routes. These are alternatives to investigate, not tested first-party Windows support. Old CUDA 11.8/FlashAttention assumptions need qualification on Blackwell; no first-party ComfyUI route was verified. **Fit:** slower legacy comparison, with clearer commercial terms than YuE2 for companies. [Y5], [Y7], [T1]

**YuE2.** The official baseline is Linux, Python 3.12, BF16, 24 GB VRAM and 24 GB free host RAM. Its hardware page reports a 4090 producing 214.85 seconds of audio in a mean 71.04 seconds across 32 warm requests, with 11.18 GiB measured peak; the maximum-context memory result is different. That warm benchmark excludes initialization/file saving and is not a minimum or a 5090 forecast. Native Windows CUDA is documented as **experimental**, using PyTorch 2.10/CUDA 12.8; an 8 GB laptop success report uses constrained settings. The official project also links a Comfy-Org YuE2 workflow. [Y1], [Y4], [Y8]

YuE2 generates full 48 kHz stereo songs through editable ABC melody/chord planning. Editing the score regenerates audio; it does not promise untouched waveform regions outside an edit. Its cover route adds SheetSage2 transcription and related model dependencies, whose licenses need separate review. No native export of independently editable instrument stems was verified. **Fit:** composition control worth evaluating after resolving the individual-versus-company license, with no assumption that the Windows or Comfy route matches every native feature. [Y1], [Y2], [Y3], [Y9]

### Stable Audio Open 1.0 and Small

**Open 1.0.** Generates up to 47 seconds of 44.1 kHz stereo. The card emphasizes effects/recordings and acknowledges limitations in realistic vocals and music. Treat it as a sample/texture/short-loop source rather than a structured song engine. [S1]

A later official paper measures the original Open baseline at **5.51 GB peak on H100**, 100 steps, with 3.56 generated audio seconds per wall-clock second. This is a measured setup, not a universal minimum. Do not attach Small's faster timings to Open 1.0. On Windows, the Comfy-Org Open 1.0 repack is an evidenced ComfyUI route; official native alternatives are stable-audio-tools/Gradio or Diffusers, with a compatible runtime still to be qualified. [S3], [S4], [S5]

**Open Small.** The released card specifies **up to 11 seconds**, 44.1 kHz stereo, eight inference steps. The paper evaluates an approximately 11.89-second configuration; keep those duration statements distinct. It reports **4.06 GB H100 peak**, 156.42 audio seconds per wall-clock second and approximately 187 ms on RTX 3090 for that short example. None is a local startup-to-WAV measurement. The documented route is native stable-audio-tools; a matching first-party Small ComfyUI workflow was not verified. [S5], [S6]

**Editing and fit for both.** No native stem-export or faithful-cover facility was verified. The shared tools support initialization from audio, and the Small paper discusses audio-to-audio creative use; neither establishes a precise region-repaint guarantee for these released checkpoints. Exact beats, key, clean tails and seamless loops need producer work. Both are credible memory-capacity candidates for 32 GB, subject to runtime qualification. Small is the more relevant fast percussion/texture experiment; Open offers longer material. Neither clears commercial use merely because the tooling is MIT. [S1], [S2], [S3], [S5], [S6]

### MusicGen

**Memory and speed.** Official guidance recommends at least 16 GB VRAM for medium/melody (1.5B); small is 300M and large 3.3B. No comparable 5090 wall-clock measurement was found. Audio token rate is not generation speed. The 32 GB target is plausible for documented medium configurations, without a claim that every large/stereo/long-context configuration fits. [M2], [M3]

**Length and controls.** Primarily 30-second generation windows with continuation/extension support, at 32 kHz in mono or stereo variants. Melody models condition on chroma; continuation extends an existing prompt. Neither guarantees a faithful cover. No native independent stems or arbitrary regional repaint was verified. **Fit:** useful noncommercial baseline for short phrases, not the recommended commercially usable production source. [M3], [M4]

**Windows route.** The repository's native Python/Gradio route pins Python 3.9 and PyTorch 2.1.0, predating Blackwell support. The official docs also describe Transformers integration: a current compatible Transformers/PyTorch environment would need separate qualification. No first-party ComfyUI installation was established. Do not resolve dependency conflicts by changing this project's environment during research. [M1], [M3], [T1]

### Magenta RealTime: legacy v1 and current v2

**Memory and speed.** Current main documents MRT2 small (230M) and base (2.4B). Supported real-time streaming is centered on Apple Silicon; NVIDIA is documented for offline/batch Python inference. No authoritative NVIDIA peak-VRAM requirement or 5090 benchmark was found, so “fits and runs live on 32 GB” remains unverified. The older 800M v1 report generates two seconds in 1.25 seconds on a Colab TPU v2-8, using ten seconds of context; that is not a Windows GPU benchmark. [R1], [R3], [R6]

**Length and controls.** Both are continuous 48 kHz stereo instrumental-generation systems rather than guaranteed verse/chorus song planners. Text/audio examples steer the sound; MRT2 also accepts MIDI control. It produces **audio, not editable MIDI output**. Capture useful passages offline; no native separated-stem export, waveform repaint or faithful-cover function was verified. Low control latency is not the same measurement as rendering throughput. [R2], [R5], [R6]

**Windows route.** MRT2's official Python route uses JAX for batch generation and MLX for Apple streaming. JAX's platform table says NVIDIA GPU on native Windows is unsupported and WSL2 is experimental. Thus Windows/5090 means an experimental WSL2/Linux batch investigation, not the macOS DAW plugin or a verified native ComfyUI route. Legacy v1 should remain a separate version-pinned experiment. **Fit:** interesting evolving textures; a later offline source, never a replacement for EUTONOS's playback clock. [R3], [R4]

### DiffRhythm v1.2 and DiffRhythm2

**v1.2 memory/speed.** The official README advertises base inference with at least 8 GB when using chunked decoding; it does not establish an exact full-model peak. Base is about 95 seconds, full up to 285 seconds. The original paper's RTX 4090 figures correspond to approximately 3.5 seconds for 95 seconds and 9.7 seconds for 285 seconds (derived from its time/audio ratios). These original-paper results must not be relabeled as v1.2 or 5090 tests. [D1], [D5]

**v1.2 controls/Windows.** The release adds song editing and continuation, with instrumental generation and text/audio style reference. Native instrument stems and faithful covers were not established. Official Windows instructions include Python 3.10, eSpeak NG/DLL configuration and batch inference entry points; WSL/Linux is an alternative. No first-party ComfyUI route was verified. **Fit:** plausible fast mixed-audio candidate, but its Apache main checkpoint does not remove the Stability license on the required VAE. [D1], [D2], [D3], [D4]

**DiffRhythm2 is a separate release.** Its official code and card specify Apache-2.0, with a new VAE. The paper reports full songs up to 210 seconds and **25.6 seconds for 120 seconds of audio on RTX 4090, 32 steps**. An official numerical minimum/peak VRAM was not found; a 32 GB trial is plausible from that 4090 result, not proven. [D6], [D7], [D8], [D9]

The checked v2 material supports mixed-song generation; separate stems, faithful covers and regional repaint were not verified. Do not inherit v1.2 features merely from the family name. Its README mentions Windows eSpeak installation, but the supplied inference route is a shell script: WSL2/Linux is the better documented starting point; full native Windows and ComfyUI compatibility remain unverified. **Fit:** a later alternative to ACE-Step with permissive main-release terms, pending dependency and runtime qualification. [D6], [D7]

### SongGeneration / LeVo

**Evidence limitation.** Tencent's main GitHub repository returned 404 and its current model card returned 401 during this check. This is an access finding, not proof of withdrawal. The comparison therefore anchors to the accessible, pinned **official Tencent SongPrep README and LICENSE**, rather than silently substituting a community model card. [G1], [G2], [G3], [G4]

**License.** The custom Tencent license expressly covers both inference code and model weights and restricts use to academic, research and education purposes, prohibiting commercial or production use. MIT notices for included dependencies do not change that. No separate commercial-output permission was established. Treat production use as blocked without different written permission. [G2]

| Verified historical checkpoint | Maximum song length | VRAM without / with prompt audio | Published A100 “RFT” |
| --- | --- | --- | --- |
| base / base-new | 2m30s | 10 / 16 GB | 1.26 |
| base-full | 4m30s | 12 / 18 GB | 1.30 |
| large | 4m30s | 22 / 28 GB | 1.51 |

These are the pinned README's numbers, suggesting capacity on 32 GB, not qualification. It calls the timing column “Real Forward Time,” excludes loading and gives no formula; do not convert it to seconds or assume the direction of a real-time factor. [G1]

**Controls and Windows.** Full songs, instrumental-only, vocals-only and separate vocal/accompaniment outputs are documented. Two broad tracks are not individual instrument stems. Audio prompting targets similar style; faithful covers, waveform repaint and seamless loops were not established. The official instructions primarily use Python/CUDA, shell scripts and Linux Docker, and link a **community Windows ComfyUI integration**. That wrapper's historical Windows 11/CUDA 12.4 environment is not a 5090 test. **Fit:** research reference only. Newer LeVo-labelled mirrors were not used to infer a canonical license change or a verified Tencent migration. [G1], [G5], [T1]

## MIDI and pattern generators

These produce note/event material to arrange and voice in FL Studio. MIDI is not an S06 WAV asset. Their useful “stems” are independent MIDI parts rendered through instruments, not separation of an existing audio mixture.

| Model | Pattern/song scope and editing | VRAM and speed evidence | Windows route and project fit |
| --- | --- | --- | --- |
| **MusicVAE** | Checkpoints for two-bar melodies/drums, four-/16-bar trios and chord-conditioned multitrack patterns; latent interpolation and sequence editing. Song structure comes from arrangement. No audio repaint, source separation or faithful-cover facility. | No numerical inference VRAM minimum or 5090 timing in checked official docs. Checkpoint download size is not runtime VRAM. | Official TensorFlow.js browser/Node route on Windows is the first candidate; legacy Python TensorFlow is a separate compatibility problem. Useful structured patterns, pending checkpoint-license evidence. [P2], [P3], [P4] |
| **GrooVAE** | Two-bar drum humanization, one-to-four-bar tap-to-drum models, four-bar autoencoder. Outputs drum events; render kit pieces separately if needed. No full-song generator, audio repaint or cover workflow. | No official target VRAM/speed requirement found. Small listed checkpoint sizes do not establish measured memory use. | Same official Magenta.js route, no CUDA/ComfyUI requirement. Good proposed groove variation source, but code Apache-2.0 does not establish the hosted weights' license. [P1], [P2], [P3], [P4] |
| **Performance RNN** | Expressive piano events with velocity/timing and primer-based continuation; not guaranteed bar-locked loops or multi-instrument songs. MIDI edits are possible; audio stems/repaint/covers are not provided. | Official browser live-generation example, but no numeric 5090/VRAM requirement found. | Official TensorFlow.js browser implementation; legacy Python alternative. Potential piano phrase source after rights clarification and grid editing. [P1], [P5] |
| **SkyTNT MIDI Model, tv2o-medium** | Multi-track symbolic generation/continuation; arrange passages into songs in FL. Separate channels can become rendered parts. No waveform repaint, source separation or promised faithful covers. | Official card lists approximately 0.2B parameters and ONNX files; no minimum VRAM or wall-clock benchmark. A light candidate relative to audio models is an inference, not a measured result. | Repository links a Windows app and native Python/PyTorch/FluidSynth workflow; ONNX is an alternative path. No ComfyUI needed. Preferred MIDI experiment because checked code and checkpoint both explicitly use Apache-2.0. [P6], [P7] |

Magenta's older Python repository is archived; prefer evaluating the documented JavaScript implementations rather than assuming its old TensorFlow stack will use the 5090. The separate checkpoint grant remains an unresolved rights question, not a declaration that the weights are forbidden. Browser-hosted demos are evidence of implementation, not permission to fetch assets or send project material to an online service in this task. [P2], [P5]

## Proposed feed into this project

### Keep generation outside playback

The [product goal](../PRODUCT_GOAL.md) prioritizes the standalone three-layer player/generator and shared portable contracts. Treat these models as **optional offline producers** of files. A generation job may take milliseconds or minutes without affecting audio-clock deadlines. Windows/FL may author content; approved packs should remain playable on the project's supported platforms without a model, GPU or FL installation.

Two proposed routes converge on the existing S06 importer. No producer adapter or new service is implemented here:

1. **Audio route:** generate candidate instrumental sections or textures outside the repository; import them into FL Studio for audition, grid alignment, trimming, fades, level management and arrangement; export final candidate WAVs. If a generated loop already satisfies the contract, the producer may package it directly for S06, with the same evidence and listening requirements.
2. **MIDI route:** generate/edit a note pattern, assign rights-documented FL instruments, verify notes/tempo/harmony and render individual parts or short samples. Assemble two candidate recordings from those parts, or prepare the exact short samples required by the performer palette. Independent MIDI parts give more reliable editing control than expecting a mixed-song model to produce clean isolated instruments.

The existing [FL route](../S09_FL_IMPORT.md) remains the production reference. If later automated, use the repository's designated single FL writer; parallel workers may research or analyze files but must not compete for the FL session. This document neither drives FL nor copies existing owner-local media.

### Prepare musical assets, not just prompt metadata

A proposed first comparison is instrumental material at **120 BPM, 4/4**, with a four-bar harmonic plan and matching A/B sections. Eight bars at that tempo equal 16 seconds, derived as 8 x 4 x 60 / 120. Ask for longer source material when useful, then select and render the exact boundary in FL. A prompt saying “120 BPM, C minor, seamless loop” is an intention, not proof of tempo, key or a click-free seam.

Record the model/revision, code revision, exact checkpoint/codec licenses, prompt, seed, steps, precision, requested duration, reference provenance and any FL processing in a production log. Later record actual runtime/peak VRAM separately from listening judgments. Keep source and final rendered hashes so a change to a fade, level, instrument or sample can be traced. These are proposed producer records, not new mandatory JSON keys.

### S06 has two different destinations

| Destination | Suitable model material | Existing boundary |
| --- | --- | --- |
| **Recording assets** | Curated rendered loops/sections, including mixtures | Current browser loader accepts one or two eligible recordings and at most 16 MiB aggregate audio, a 256 KiB manifest and 64 KiB per evidence file. Palette-only packs do not satisfy that loader. |
| **Performer palette** | Individual short drum, percussion, bass and harmony samples, often better rendered from MIDI/instruments | `s06-performer-palette@1`: 120 BPM, 4/4, four-bar phrases, exactly one sample for each of the four roles; pitched-role roots and reuse rights are required. |
| **Full generated song** | Source for owner audition and later section selection | Do not insert it wholesale into the browser pack. Five minutes of 44.1 kHz stereo PCM16 is about 52.9 MB before headers (calculated), above the current audio cap. |

For the performer palette, at 120 BPM the maximum role lengths are **drum 0.25 s, percussion 0.125 s, bass 0.5 s, harmony 1 s**. The sampler does not transpose; roots must match the actual source and the permitted harmony, and switching palettes retains the event pattern. An eight-bar generated loop is therefore a **recording**, not a drop-in sampler voice. Extracting/synthesizing these short sounds and granting sample reuse need separate producer work. [S06 contract](../S06_IMPORT.md); [sampler implementation](../../src/pack.ts); [browser limits](../../src/browser-pack.ts).

### Deliver through the existing data-only contract

The future handoff is a folder containing `delivery.json`, named WAVs and nonempty UTF-8 rights evidence, following **`em.producer-delivery.v0`**. Use only existing fields. Producer identity/revision/kind/description are recorded with `verified: false`; that receipt does not authenticate a model or artist. Asset entries use the contract's portable relative `source`, with optional `expected_sha256` and `keep_frames`. Keep additional model/process details in evidence or a separate log, not arbitrary JSON keys, because unknown fields are rejected. [S06 contract](../S06_IMPORT.md); [importer](../../src/importer.ts).

The importer measures PCM16 sample rate, channels, frame counts and hashes, rejects silent/full-scale-clipped assets, writes canonical WAV headers without changing PCM, emits `IMPORT.json` and validates the pack. Its aggregate read limit is 256 MiB, separate from the smaller browser limit. The output directory must be new. `keep_frames` only removes an already silent tail at the documented threshold; it is not a musical editing tool. Do musical cuts and fades in the producer/FL step first. Pack validation and browser acceptance are separate checks. [S06 contract](../S06_IMPORT.md)

### Owner listening is a separate gate

**Every candidate stays labelled NOT TESTED until the owner listens to the exact final audio.** This prose/evidence label must not be inserted as an eligibility enum.

| Contract state | What it actually allows |
| --- | --- |
| `unreviewed` | Candidate material; cannot play through the current loader, including fixture mode. Owner can audition the source in FL first. |
| `fixture-only` | Explicit fixture/demo audition where supported; still NOT TESTED until heard and not accepted for general listening. Do not silently relabel production candidates merely to bypass review. |
| `listening-reviewed` | Requires the project's separate owner-review/acceptance process. S06 rejects a producer delivery claiming this value; the producer cannot self-approve. |

Record who listened, date, exact hashes, device/output and decisions on seam clicks, tuning/tempo, artifacts, unwanted vocals, balance, repetition fatigue and transitions among the project's layers. Automated silence/clipping/format checks do not substitute for that review. A listened-to file can still fail acceptance or rights checks. Do not describe an automatic eligibility-promotion tool as implemented; follow the existing [listening plan](../FIRST_PLAYABLE.md) and current owner-led S10 boundary. [S06 contract](../S06_IMPORT.md); [current tasks](../CURRENT_TASKS.md)

## Bounded next evaluation, if separately authorized

Compare a small fixed set: ACE-Step 2B Turbo and XL Turbo on the same section brief; one XL-base editing task only if needed; SkyTNT notes rendered through the same FL palette; optionally Stable Audio Open Small for percussion if its license fits. Use consistent section lengths and levels, retain failures, and let the owner judge usefulness blind to model identity where practical.

Measure cold startup separately from warm generation, audio duration, checkpoint/precision/steps, peak GPU/system memory, out-of-memory failures and final preparation time. The practical winner is the source that yields accepted, rights-documented, reusable project material with manageable editing effort. Published throughput alone cannot decide that.

## Research closeout

The assigned outcome is this comparison and proposed handoff, not installed capability. Official links and version distinctions were checked; runtime, music quality, dependency compatibility, FL rendering, imported generated packs and physical listening remain **NOT TESTED**.

The optional managed EUTONOS settings/workflow commands reported a missing selected runtime. This task uses the repository's documented Markdown fallback; no runtime was installed and no native workflow receipt is claimed. The proposal is the recoverable task checkpoint and closeout record. No campaign status, existing rights claim or owner acceptance is changed.

Documentation validation covers reference definitions, repository-relative targets, whitespace and a diff restricted to this file. No build, inference, audio or application test is warranted by this docs-only change. No upstream model/media download, code change, push or merge is part of this task.

## Official source register

All entries were checked on 2026-11-08 UTC. Repository READMEs establish documented capabilities/routes; model cards and license files establish the stated checkpoint terms; papers provide the identified benchmark configurations. Except for the two explicitly failed Tencent URLs, the cited pages were accessible. This is a source check, not an audit of training data or a guarantee that a later upstream revision is unchanged.

- **ACE-Step:** [A1] repository/capability matrix; [A2] code license; [A3] 1.5 card; [A4] XL Turbo card; [A5] XL-base card; [A6] GPU guide; [A7] installation guide.
- **YuE:** [Y1] current YuE2 repository; [Y2] model license; [Y3] YuE2-3B card; [Y4] hardware/Windows benchmarks; [Y5] legacy stage-one card; [Y6] stage-two card; [Y7] pinned legacy README; [Y8] official-linked Comfy-Org workflow; [Y9] cover-model setup dependencies.
- **Stable Audio:** [S1] Open 1.0 card; [S2] applicable Community license; [S3] tools repository; [S4] Comfy-Org Open repack; [S5] official Small/ARC paper and Open baseline measurements; [S6] Small card.
- **MusicGen:** [M1] AudioCraft repository/setup; [M2] official model card/license split; [M3] generation documentation; [M4] continuation/extension API.
- **Magenta RealTime:** [R1] current repository; [R2] MRT2 card/terms; [R3] installation/backends; [R4] JAX platform support; [R5] legacy card/terms; [R6] legacy release/TPU timing.
- **DiffRhythm:** [D1] v1 repository/Windows/editing; [D2] 1.2-full card; [D3] VAE card; [D4] VAE license; [D5] original paper; [D6] v2 official repository; [D7] v2 card; [D8] v2 code license; [D9] v2 paper, Appendix B/Table 6.
- **SongGeneration:** [G1] pinned Tencent README; [G2] pinned Tencent license covering code and weights; [G3] current Tencent GitHub (404); [G4] current Tencent model card (401); [G5] community ComfyUI repository linked by Tencent, used only for its own Windows route claim.
- **MIDI/patterns:** [P1] Magenta.js code license; [P2] official JavaScript implementations; [P3] checkpoint index; [P4] MusicVAE/GrooVAE description; [P5] Performance RNN/browser implementation; [P6] SkyTNT repository/Windows route; [P7] exact tv2o-medium checkpoint card.
- **Runtime context:** [T1] official PyTorch Blackwell/CUDA 12.8 announcement.

[A1]: https://github.com/ace-step/ACE-Step-1.5
[A2]: https://github.com/ace-step/ACE-Step-1.5/blob/main/LICENSE
[A3]: https://huggingface.co/ACE-Step/Ace-Step1.5
[A4]: https://huggingface.co/ACE-Step/acestep-v15-xl-turbo
[A5]: https://huggingface.co/ACE-Step/acestep-v15-xl-base
[A6]: https://github.com/ace-step/ACE-Step-1.5/blob/main/docs/en/GPU_COMPATIBILITY.md
[A7]: https://github.com/ace-step/ACE-Step-1.5/blob/main/docs/en/INSTALL.md
[Y1]: https://github.com/multimodal-art-projection/YuE
[Y2]: https://github.com/multimodal-art-projection/YuE/blob/main/MODEL_LICENSE
[Y3]: https://huggingface.co/m-a-p/YuE2-3B
[Y4]: https://github.com/multimodal-art-projection/YuE/blob/main/docs/hardware.md
[Y5]: https://huggingface.co/m-a-p/YuE-s1-7B-anneal-en-cot
[Y6]: https://huggingface.co/m-a-p/YuE-s2-1B-general
[Y7]: https://huggingface.co/m-a-p/YuE-s1-7B-anneal-en-cot/blob/3098013e400538abf6b9265a21b247d65bf51560/README.md
[Y8]: https://github.com/Comfy-Org/workflow_templates/blob/main/templates/audio_yue2_text2music.json
[Y9]: https://github.com/multimodal-art-projection/YuE/blob/main/skills/yue2-music/references/models-and-setup.md
[S1]: https://huggingface.co/stabilityai/stable-audio-open-1.0
[S2]: https://huggingface.co/stabilityai/stable-audio-open-1.0/blob/main/LICENSE.md
[S3]: https://github.com/Stability-AI/stable-audio-tools
[S4]: https://huggingface.co/Comfy-Org/stable-audio-open-1.0
[S5]: https://arxiv.org/pdf/2505.08175
[S6]: https://huggingface.co/stabilityai/stable-audio-open-small
[M1]: https://github.com/facebookresearch/audiocraft
[M2]: https://github.com/facebookresearch/audiocraft/blob/main/model_cards/MUSICGEN_MODEL_CARD.md
[M3]: https://facebookresearch.github.io/audiocraft/docs/MUSICGEN.html
[M4]: https://facebookresearch.github.io/audiocraft/api_docs/audiocraft/models/musicgen.html
[R1]: https://github.com/magenta/magenta-realtime
[R2]: https://huggingface.co/google/magenta-realtime-2
[R3]: https://github.com/magenta/magenta-realtime/blob/main/docs/installation.md
[R4]: https://docs.jax.dev/en/latest/installation.html
[R5]: https://huggingface.co/google/magenta-realtime
[R6]: https://magenta.withgoogle.com/magenta-realtime
[D1]: https://github.com/ASLP-lab/DiffRhythm
[D2]: https://huggingface.co/ASLP-lab/DiffRhythm-1_2-full
[D3]: https://huggingface.co/ASLP-lab/DiffRhythm-vae
[D4]: https://huggingface.co/ASLP-lab/DiffRhythm-vae/blob/main/LICENSE.md
[D5]: https://arxiv.org/html/2503.01183v1
[D6]: https://github.com/ASLP-lab/DiffRhythm2
[D7]: https://huggingface.co/ASLP-lab/DiffRhythm2
[D8]: https://github.com/ASLP-lab/DiffRhythm2/blob/main/LICENSE
[D9]: https://arxiv.org/pdf/2510.22950
[G1]: https://huggingface.co/spaces/tencent/SongPrep/blob/3ef94635924ed58cdd21b90d45aab4e45d863694/README.md
[G2]: https://huggingface.co/spaces/tencent/SongPrep/blob/ef01ecd3d88647c9f7c1be92262b11225035127c/LICENSE
[G3]: https://github.com/tencent-ailab/SongGeneration
[G4]: https://huggingface.co/tencent/SongGeneration
[G5]: https://github.com/smthemex/ComfyUI_SongGeneration
[P1]: https://github.com/magenta/magenta-js/blob/master/LICENSE
[P2]: https://github.com/magenta/magenta-js/blob/master/music/README.md
[P3]: https://github.com/magenta/magenta-js/blob/master/music/checkpoints/README.md
[P4]: https://github.com/magenta/magenta/blob/main/magenta/models/music_vae/README.md
[P5]: https://github.com/magenta/magenta/blob/main/magenta/models/performance_rnn/README.md
[P6]: https://github.com/SkyTNT/midi-model
[P7]: https://huggingface.co/skytnt/midi-model-tv2o-medium
[T1]: https://pytorch.org/blog/pytorch-2-7/
