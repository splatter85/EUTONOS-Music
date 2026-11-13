# Music Studio arranger research: features, tools, models and quality passes

Document ID: `EM-D031`  
Status: **RESEARCH - web and local-documentation review, 2026-11-13; nothing installed, downloaded or heard**  
Feeds [the arranger proposal](STUDIO_ARRANGER.md) (EM-D030) and [EMS](../campaigns/EMS_MUSIC_STUDIO.md).

**How it was done:**
- Two research agents worked from web search results and the local ACE-Step 1.5 documentation and source.
- Many web claims rest on search summaries, not fetched primary pages. They are marked accordingly.
- Benchmark numbers are the publishers' own claims.
- Nobody listened to anything, so nothing here says something sounds better.

## 1. How products expose section and timeline control

| Product | Concepts | Evidence |
| --- | --- | --- |
| **ElevenLabs Music** | A *composition plan*: global positive/negative styles plus timed sections or chunks, each with its own style, duration in ms and lyric lines. Copyrighted names in styles are rejected. | Vendor docs (search summary): [composition plans](https://elevenlabs.io/docs/eleven-api/guides/how-to/music/composition-plans). The schema appears to have moved from `sections` to `chunks`. The closest analogue to the owner's Advanced mode. |
| **Suno** | Studio: a browser DAW with up to 12 stems and export of ranges. **Replace Section** (reported to give two alternatives to compare). Extend. Personas. | [Product page](https://suno.com/products); [help centre](https://help.suno.com/en/categories/2828097); details mostly third-party. |
| **Udio** | Inpainting (select a section, regenerate, keep the rest) and extend. | Third-party reports. |
| **Stable Audio 2.5** | Inpainting of selected sections from a text prompt (hosted API). | [ComfyUI node docs](https://docs.comfy.org/built-in-nodes/StabilityAudioInpaint). |
| **Lyria RealTime / MusicFX DJ** | Streaming generation steered by weighted prompts; continuous style steering rather than verse/chorus planning. | [Gemini API docs](https://ai.google.dev/gemini-api/docs/realtime-music-generation). |
| **Soundraw** | Song split into blocks, each with an editable energy level. | Background knowledge, not verified this session. |

The recurring vocabulary is: **sections or blocks with a duration, a per-section style, per-section lyrics, a per-section energy, stems, and region replace or extend.** No community ACE-Step tool combining a timeline with repaint, lego and extract was found apart from one unreviewed Hugging Face Space. That combination is an open gap.

## 2. Tools that modify existing songs

**Stem separation (local, open):**
- HTDemucs: MIT code, archived upstream with a community fork. About 9.0 dB SDR on MUSDB18-HQ ([repo](https://github.com/facebookresearch/demucs)).
- Mel-Band RoFormer and BS-RoFormer: vocals about 11.2 vs 10.8 dB in the [Mel-RoFormer paper](https://arxiv.org/html/2310.01809v1).
- Weight licences vary by checkpoint, some non-commercial, so check each one.
- Published scores are on real recordings. Separation quality on AI-generated music is unmeasured.

**Rebalance** (for example iZotope RX Music Rebalance) is exactly "make the vocals louder". The local equivalent is separate, per-stem gain, then re-sum.

**Mastering:** [Matchering](https://github.com/sergree/matchering) is GPL-3.0. It matches loudness, EQ and stereo width to a reference. Run it as a separate tool; do not copy its code. LANDR and Ozone are commercial.

**Stem-DJ and mashup tools:** djay Neural Mix, Serato Stems, rekordbox, VirtualDJ and Fadr use proprietary separation (background knowledge only). The EUTONOS DJ already covers analysis and beatmatching, and stems are the missing piece.

**Voice conversion:** using a real person's voice without consent is a rights and platform risk. Limit it to the owner's own voice or licensed voices.

## 3. Research on time- and structure-conditioned generation

| Work | What it controls | Local use |
| --- | --- | --- |
| JASCO (Meta) | Chords, beats, melody aligned in time | Reported MIT code with non-commercial weights; terms not confirmed |
| Music ControlNet | Time-varying melody, dynamics (an energy curve) and rhythm | Weights not found |
| DITTO | Inference-time steering of intensity, melody and structure | Code or weights not found |
| Diff-A-Riff | Adds an instrument layer to an existing mix | Weights not found |
| Stable Audio inpainting | Masked time-range regeneration | Hosted (2.5); open-weight Stable Audio 3 reported, licence not found |

The only confirmed local, open, task-level support for the owner's wishes is ACE-Step 1.5 itself: repaint, extend, cover, and lego/extract/complete on the base model. An energy-curve conditioner is not available, so energy is realized by repaint candidates plus gain and filter automation.

## 4. Stronger local models (as of November 2026)

| Model | Licence | Fit for this PC | Claims (publisher's own) |
| --- | --- | --- | --- |
| **ACE-Step 1.5 XL** (in use) | MIT | Runs now (Windows, RTX 5090) | "Between Suno v4.5 and v5"; repaint, cover, extend; lego/extract/complete on XL Base ([repo](https://github.com/ace-step/ACE-Step-1.5)) |
| YuE2 | Apache code; **weights CC BY-NC 4.0** with creator permission | 24 GB; Linux first, Windows experimental | Best-of-8 near Suno v5 on one benchmark; edits regenerate the whole song ([repo](https://github.com/multimodal-art-projection/YuE)) |
| HeartMuLa 3B | Apache-2.0 (weights included) | Windows not stated; slower (RTF about 1) | Section tags; no editing in the main repo ([repo](https://github.com/HeartMuLa/heartlib)) |
| StepAudio 3 Music | No weights found | n/a | Strong vocal claims ([arXiv 2609.16034](https://arxiv.org/abs/2609.16034)) |
| SongGeneration / LeVo v2 | Unclear | 22–28 GB | Not verified |
| DiffRhythm 2 | Apache-2.0 | Unknown | Up to 210 s; extension still to do |
| SongBloom | Academic use | 150 s maximum | Small human test |
| Stable Audio Open 1.0, MusicGen, Magenta RT | Various | Short or no vocals | Not full-song vocal models |

**Verdict:** nothing open that could be verified clearly beats ACE-Step 1.5 XL here. Owner A/B candidates are YuE2 (personal use, Linux/WSL) and HeartMuLa (Apache). Each install needs owner approval.

## 5. Quality levers in ACE-Step 1.5 and what Music Studio uses

From the local ACE-Step docs (Inference, API, DCW, Alt VAE, Tutorial, Musicians' guide) and Music Studio's job payload:

| Lever | Documented | Music Studio today |
| --- | --- | --- |
| Checkpoint | turbo, SFT or base; docs call XL SFT "highest quality" | XL Turbo (default) and XL Base; **SFT not installed** |
| Steps | turbo 8; base/SFT 32–64+ | 8 / 50 |
| Guidance | non-turbo only | 7.0 (ignored by turbo) / 6.0 |
| Shift | 3.0 recommended; docs disagree on whether turbo honours it | not sent |
| Adaptive guidance (ADG) | base-only quality option | not sent |
| DCW sampler correction | on for turbo, off otherwise; scalers 0–0.1 | server defaults |
| Alternate VAE | community "scragvae", chosen at engine start | not used |
| LM thinking | caption, metadata and language planning | on, LM CFG 2.5 |
| Batch | `batch_size` | 1 per job (variations are sequential) |
| LoRA | about 16–20 GB to train | not wired |

**Automatic scoring for best-of-N:**
- [Audiobox Aesthetics](https://huggingface.co/facebook/audiobox-aesthetics) (CC-BY-4.0, pip install).
- [SongEval](https://arxiv.org/pdf/2505.10793) (CC BY-NC-SA, personal use).
- Neither is validated against the owner's taste. Track agreement with ❤️/👍/👎 before trusting either.

**Super-resolution** (AudioSR and similar) has low expected value, because the output is already full-band. It was not measured.

## 6. Unknowns

- Whether repaint seams are audible on bar lines. Needs owner listening.
- Whether shift, ADG and DCW are honoured by the local API, and whether they help.
- Whether XL SFT beats XL Turbo for the owner.
- Weight licences per stem-separation checkpoint, SongGeneration and SongBloom.
- Separation quality on generated music, and Windows support for the alternative models.
- The exact current ElevenLabs plan schema, and details of commercial tools not verified this session.
