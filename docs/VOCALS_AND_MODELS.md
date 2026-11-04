# Vocals, local models, and render providers

**Status: research and proposed design.** Source review: **2026-11-03, America/Chicago**. No singing model, voicebank, provider, GPU configuration, or generated example was installed or tested for this document. Upstream capability and hardware statements below are attributed claims, not EUTONOS-Music benchmarks.

EUTONOS-Music should let an owner describe the music and voice they want, develop it with an assistant, and turn the results into reusable musical assets. The recommended starting point is two complementary production lanes: **score-controlled singing for precise vocal phrases**, and **text-to-song generation for discovering performances and arrangements**. Both feed an offline render queue and an audition process. The realtime player receives approved, cached audio and metadata.

See [the architecture](ARCHITECTURE.md) for system boundaries, [library and transitions](LIBRARY_AND_TRANSITIONS.md) for musical compatibility, and [the vocal production guide](guides/VOCAL_PRODUCTION.md) for the practical workflow. All interfaces described here are proposals; this repository does not yet implement these model adapters.

## 1. Choose the task before choosing the model

Several different tools are often described as “AI vocals.” Their inputs and responsibilities differ:

| Tool category | Input and useful output | Responsibility in this project |
| --- | --- | --- |
| Text to speech | Text and speaking instructions become spoken audio. | Spoken tags, narration, or deliberately spoken rhythmic parts. Evaluate a separate singing capability if a particular model offers one; speech support alone is insufficient. |
| Singing voice synthesis | Notes, lyrics, phonemes, timing, and expression become a sung performance. | Exact hooks, repeatable melodies, harmonies, and compatible phrase variants. DiffSinger/OpenUtau and Synthesizer V are candidates. |
| Voice conversion | A recorded or synthesized performance becomes a rendition with a different vocal timbre. | Transform an authorized guide performance. RVC is a candidate; it does not replace the composition or lyric-timing stage. |
| Full-song neural generation | Lyrics, style, and sometimes audio or symbolic conditioning become musical audio. | Discover arrangements, vocal ideas, or complete sections using ACE-Step or YuE. Precision depends on the particular controls and output. |
| Source separation | A mixture becomes estimated component tracks. | Recover candidate vocals or accompaniment when clean stems are unavailable. Separation is not composition or a guarantee of isolated originals. |
| Assistant orchestration | Musical instructions become plans, score edits, job requests, comparisons, and documentation. | Codex or Claude can coordinate available tools. The selected audio model or instrument produces the singing. |

The category distinctions follow the respective [DiffSinger](https://github.com/openvpi/DiffSinger), [RVC](https://github.com/RVC-Project/Retrieval-based-Voice-Conversion-WebUI), [ACE-Step](https://github.com/ace-step/ACE-Step-1.5), and [Demucs](https://github.com/adefossez/demucs) projects. They are not quality rankings.

An owner can dictate “make the voice darker, keep the melody, and shorten the last syllable.” The system must translate that request into the appropriate operation. A darker timbre may need a voice parameter or a new performance; a shorter syllable needs timing control; preserving the melody requires keeping a score or approved guide. Sending the same prose to every model would hide these differences.

## 2. Current local and hosted candidates

### ACE-Step 1.5: a practical local generation candidate

ACE-Step documents local text-to-music generation, lyrics, reference audio, repainting, and metadata controls. It also exposes an asynchronous HTTP API with submitted jobs and queried results. Its model family matters: support for editing and extraction operations differs between checkpoints. Evaluate the exact checkpoint and operation instead of treating every capability in the project as available in every configuration. Sources: [project](https://github.com/ace-step/ACE-Step-1.5), [API documentation](https://github.com/ace-step/ACE-Step-1.5/blob/main/docs/en/API.md).

The hardware guide describes low-memory configurations using quantization and CPU offload, with the optional language model disabled on the smallest tiers. Larger configurations add planning models and larger diffusion models. This is more useful than treating a headline “under 4 GB” claim as a promise for every duration, batch size, or quality setting. Source: [GPU compatibility guide](https://github.com/ace-step/ACE-Step-1.5/blob/main/docs/en/GPU_COMPATIBILITY.md).

**Proposed use:** generate a small set of musically related sketches or sections, audition them, and retain useful phrases. Treat requested BPM, key, lyric alignment, and isolated-stem quality as acceptance checks. A prompt field is an instruction to the generator, not evidence that its audio satisfies the instruction.

### YuE2 and legacy YuE: identify the version explicitly

The current YuE repository documents **YuE2**, whose September 2026 release adds an editable melody-and-chord plan and staged planning, semantic generation, synthesis, and decoding. Its published default setup is Linux, Python 3.12, and an NVIDIA GPU with BF16 support and 24 GB VRAM. Additional device and low-memory paths have narrower validation scopes; the hardware page explicitly distinguishes successful individual runs from established length or quality limits. Sources: [YuE2 repository](https://github.com/multimodal-art-projection/YuE), [hardware notes](https://github.com/multimodal-art-projection/YuE/blob/main/docs/hardware.md).

**Proposed use:** compare a generated arrangement with an explicitly revised score, particularly when “keep this melody but change the surrounding music” matters. Its advertised agent-editing workflow is relevant, but EUTONOS-Music still needs to verify lyric fidelity, singer continuity, and section boundaries on its own material.

The original YuE remains on the repository’s **YuE-v1** branch. Its official stage-one and stage-two model cards describe lyrics-to-song generation and identify those weights as Apache-2.0. Do not apply those older licenses, setup instructions, or resource claims to YuE2. Sources: [legacy stage one](https://huggingface.co/m-a-p/YuE-s1-7B-anneal-en-cot), [legacy stage two](https://huggingface.co/m-a-p/YuE-s2-1B-general).

### DiffSinger with OpenUtau: control the vocal performance

OpenVPI’s DiffSinger provides singing synthesis with pitch and other expressive controls. OpenUtau supplies a local editor and a supported deployment route. Its documentation describes CPU rendering by default, optional Windows DirectML or macOS CoreML acceleration, and expressions whose availability depends on the voicebank or vocoder. A voice with no trained breathiness or vocal-color support cannot acquire those controls merely because the editor displays a curve. Sources: [DiffSinger](https://github.com/openvpi/DiffSinger), [OpenUtau support](https://openutau.com/DiffSinger-support/).

**Proposed use:** author exact notes, phonemes, and phrase timing; render a stable singer across sparse, expressive, and intense versions of the same hook. This lane provides the clearest place to correct one consonant or one note without regenerating the entire instrumental arrangement.

The installable editor, singing model, voicebank, variance models, dictionaries, and vocoder form a dependency set. Record each component. Building a new voicebank is a separate recording, labeling, and training project; it is not required for the first audition. OpenUtau’s [voicebank development guide](https://openutau.com/Voicebank-development/) describes those stages.

### RVC: convert an existing performance

RVC is a local voice-conversion framework. Its documentation describes pitch extraction, retrieval features, training, inference, and a realtime interface. The project’s low-latency claims are hardware dependent and do not establish latency for EUTONOS-Music. Source: [official English README](https://github.com/RVC-Project/Retrieval-based-Voice-Conversion-WebUI/blob/main/docs/en/README.en.md).

**Proposed use:** supply an approved sung guide and a voice model with the required permissions; render the converted result offline. The guide should already contain the intended melody, words, rhythm, breath placement, and expression. Conversion can introduce errors and must be auditioned. It should not be expected to turn an arbitrary spoken instruction into a polished song or repair a poor performance automatically.

A clean recording by the owner or a consenting performer is a useful starting point. A downloaded checkpoint’s availability does not establish the voice owner’s consent or its suitability for redistributed assets.

### Synthesizer V Studio 2 Pro: a local production option with pack limits

Dreamtonics describes an offline singing instrument with controls over notes, phonemes, timbre, and expression. It is a proprietary editor with separately licensed voice databases; local operation and licensing depend on the purchased product and activation state. Sources: [product information](https://dreamtonics.com/synthesizerv/), [voice terms](https://dreamtonics.com/terms/).

**Proposed use:** a separately evaluated option for personal production and finished musical works. It is **not an assumed source for the public modular vocal library**. Dreamtonics’ standard voice terms prohibit distributed sample packs, and the linked voice EULA also restricts feeding renditions into voice-generation workflows. Partner voices have their own terms. Do not use a Synthesizer V render as RVC input or as a reusable public phrase pack without establishing permission for that specific use. Source: [voice database EULA, section 3](https://dreamtonics.com/wp-content/uploads/2025/02/SynthesizerV_VDB_EULA_ALL.txt).

### Separation and hosted generation are optional adapters

**Demucs** estimates vocal, bass, drum, and other components from a mix. Its original repository points to the author’s fork, which now explicitly identifies uncertainty around pretrained weight licensing. Keep separation an optional, versioned production operation; prefer clean original stems when available. Sources: [original project](https://github.com/facebookresearch/demucs), [author’s maintained fork and license note](https://github.com/adefossez/demucs).

**Eleven Music** is an example of a documented hosted music API. Its composition plans describe ordered chunks with lyrics, styles, durations, and context adherence. The API’s supported model identifiers and plan shapes are version dependent. This could be an optional provider adapter using the same render queue as local tools, with explicit credentials, cost limits, and reference-audio upload choices. It is not a local model or an included feature of a coding-assistant subscription. Sources: [composition plans](https://elevenlabs.io/docs/eleven-api/guides/how-to/music/composition-plans), [compose endpoint](https://elevenlabs.io/docs/api-reference/music/compose), [provider usage terms](https://elevenlabs.io/music-terms).

## 3. Track four different permission questions

The code license, model-weight license, training-data provenance, and permissions for inputs and outputs are separate records. A permissive software license answers only part of the question.

| Candidate | Verified software or service facts | Weight, voice, or output qualification |
| --- | --- | --- |
| ACE-Step 1.5 | Repository uses MIT. | Official main model card identifies MIT and describes licensed, royalty-free/public-domain, and synthetic training sources. These are developer statements, not an independent audit of the training collection. Record the exact downloaded checkpoint and any added LoRA. |
| YuE2 | Repository code uses Apache-2.0. | Its model license uses CC BY-NC 4.0 plus specific additional permission for individual creators to generate and monetize outputs. That permission does not authorize company commercial use of weights or commercial redistribution of weights. |
| Legacy YuE | Version-specific official cards identify Apache-2.0, including weights. | Preserve the actual version and its dependent components. Do not inherit this row for YuE2. |
| DiffSinger / OpenUtau | DiffSinger code is Apache-2.0; OpenUtau is MIT. | Voicebank terms vary. OpenVPI’s published community vocoder weights use CC BY-NC-SA 4.0. The open editor does not remove that dependency’s restrictions. |
| RVC | Repository uses MIT. | A particular singer checkpoint, training recordings, and auxiliary weights need their own provenance and terms. The repository license does not certify every community voice model. |
| Synthesizer V | Proprietary editor and voice licenses. | Published musical works and redistributable isolated sample collections are treated differently in Dreamtonics’ terms. Partner voices must be checked individually. |
| Demucs | Current author fork identifies its code as MIT. | The same fork says pretrained weight licensing is unclear. Do not label the complete stack “MIT-cleared.” |

Sources: [ACE model card](https://huggingface.co/ACE-Step/Ace-Step1.5), [YuE2 model license](https://github.com/multimodal-art-projection/YuE/blob/main/MODEL_LICENSE), [legacy YuE card](https://huggingface.co/m-a-p/YuE-s1-7B-anneal-en-cot), [DiffSinger](https://github.com/openvpi/DiffSinger), [OpenUtau](https://github.com/openutau/OpenUtau), [OpenVPI vocoder license](https://github.com/openvpi/vocoders/blob/main/index.md), [RVC](https://github.com/RVC-Project/Retrieval-based-Voice-Conversion-WebUI), [Dreamtonics terms](https://dreamtonics.com/terms/), [Demucs](https://github.com/adefossez/demucs).

For a public EUTONOS-Music pack, select legitimately sourced recordings, lyrics, and voice assets whose terms cover the intended transformations and redistribution. Record the evidence and any attribution. Unresolved dependencies stay outside the public release. This is a project eligibility rule, not a conclusion that a model’s license automatically determines ownership of every output.

Do not commit proprietary FL Studio plugins, installers, voice databases, activation material, or model weights merely because they were used to make a render. A source project can identify an optional dependency while the public pack contains eligible rendered assets and documentation. A license to use a sample in a finished song should also be checked before distributing that sample as an isolated reusable asset.

## 4. Keep production separate from realtime playback

The native player is responsible for its audio clock, cached assets, gain changes, transitions, and continuity. Model inference belongs in another process or service. Native and browser interfaces can control production and playback; optional browser playback uses the same approved asset contract.

~~~mermaid
flowchart TD
    A[Owner brief] --> B[Production plan]
    B --> C[Render queue]
    C --> D[Local model or provider]
    D --> E[Candidate assets]
    E --> F[Audition and validation]
    F -->|revise| B
    F -->|approve| G[Versioned stem bundle]
    G --> H[Realtime playback session]
    I[Native or browser controls] --> H
~~~

The queue should isolate model dependencies, pin model identities, bound concurrent jobs, and retain results before publishing them to the library. A request needs a stable job identity, an immutable brief revision, selected inputs, generation settings, and a destination. Suggested lifecycle: submitted, preparing, rendering, validating, ready for review, accepted, failed, or cancelled. These are design states, not implemented API names.

Process isolation does not eliminate competition for CPU, memory, disk, or an accelerator. Apply resource limits and backpressure, and pause optional production work when it threatens playback. The hardware spike must verify coexistence on the intended machine instead of assuming that an offline worker cannot cause audio underruns.

Cancellation must leave a comprehensible record and must not replace an accepted asset with a partial file. A completed render first becomes a candidate. Acceptance creates a new library revision; active playback can continue using its existing revision until a safe handover. If the worker crashes, runs out of memory, loses a provider connection, or takes minutes, playback continues with its current musical material.

The cache key should include the input asset hashes, score and lyric revision, model and auxiliary weights, renderer configuration, and relevant tool versions. Store seeds when supported. A seed is useful provenance, but it is not a promise of byte-identical neural audio across software, device, precision, or provider changes. Preserve accepted audio itself.

## 5. What Codex or Claude can drive

The assistant’s proposed role is **producer and operator**. It can develop a brief, suggest original lyrics, write or revise a score, prepare compatible variants, submit jobs through an available local adapter, and explain audible differences reported by the owner. Audio-aware evaluation can assist when the active tools actually support it; text inspection alone cannot verify singing quality.

Three access paths should remain distinct:

1. **File workflow:** the assistant prepares editable scores, job descriptions, and manifests; the owner opens an editor and renders. This is a useful first implementation boundary.
2. **Local tool workflow:** an installed CLI, documented local API, or supported project-file adapter submits and collects jobs. Each adapter declares which operations it really supports.
3. **Native or browser operation:** when an assistant session has appropriate UI tools, it can operate an installed editor or a local web interface. UI actions require observed controls and exported results; an imagined universal DAW automation API is not a dependency.

An embedded application integration must supply its own supported authentication and billing configuration. The design must not assume that a ChatGPT/Codex or Claude subscription is a reusable music-generation API entitlement, or that credentials from a desktop session can be repurposed. Local singing models can remain fully independent of whichever assistant helps author the request.

## 6. Hardware and quality gates for the first spike

Select a pilot using the actual machine’s OS, accelerator, VRAM, system RAM, disk capacity, and driver support. These are unresolved environment inputs. Do not buy hardware or promise latency from a model’s parameter count.

| Pilot | What to establish | Evidence to retain |
| --- | --- | --- |
| Existing score-based voicebank | A short phrase renders locally with usable pronunciation and expression. | Exact voicebank/vocoder versions, permissions, project, audio, render time, peak resources. |
| ACE-Step configuration | A bounded set of sketches can produce usable material at the target tempo and style. | Checkpoint, optional planner, offload/precision settings, all candidates, accepted result. |
| YuE2, if hardware and terms fit | An edited symbolic plan produces useful controlled revisions. | Original/edited plan, weights, runtime, duration, failed attempts, listening notes. |
| Optional conversion | A guide retains words, timing, and expression after conversion. | Guide, authorized voice model, conversion settings, before/after audio. |

Run one worker initially. Compare cold loading with warm rendering, and measure memory as well as wall-clock time. Repeat only enough to resolve the concrete deployment risk: successful short inference alone does not establish long-form reliability, cancellation recovery, or safe coexistence with playback.

Quality acceptance is musical. The [production guide](guides/VOCAL_PRODUCTION.md#8-evaluate-the-vocal-before-accepting-it) defines a repeatable rubric for pronunciation, pitch, timing, formants, expression, continuity, artifacts, and transitions. Listen to dry vocals and the actual mix. Retain rejected takes so selection quality is visible; do not report only the best example as typical performance.

## 7. Decisions that remain open

The first vocal prototype must establish a usable, appropriately licensed voice stack, the actual hardware envelope, and whether desired voice continuity survives independent renders. It must also determine how much score and phoneme editing the owner wants, how many variants per recipe are worthwhile, and which model operations have acceptable repair cost.

An initial vocal deliverable should contain one auditioned vocal family, its editable source, a small compatible stem bundle, recorded provenance, a reproducible render procedure, and listening notes. It should demonstrate that the same approved voice can support more than one arrangement intensity while preserving phrase boundaries. Broader model integrations follow evidence from that result.
