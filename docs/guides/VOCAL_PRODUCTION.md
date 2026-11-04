# Producing vocals for an adaptive music library

**Status: proposed production workflow, not a tested model tutorial.** Source review: **2026-11-03, America/Chicago**. No audio was generated or auditioned while writing this guide. Model choices, hardware requirements, and exact licensing qualifications are documented in [Vocals and models](../VOCALS_AND_MODELS.md).

The objective is a vocal performance that sounds intentional, belongs to a musical family, and can enter or leave an adaptive arrangement cleanly. A finished song is useful inspiration, but a library also needs understandable phrase boundaries, compatible harmonies, alternate intensities, and evidence that its assets may be shared in the intended form.

This guide uses **asset**, **stem bundle**, **recipe**, **arrangement plan**, **transition edge**, **mix plan**, and **playback session** consistently with [the project architecture](../ARCHITECTURE.md). Examples are production sketches, not an implemented file schema.

## 1. Turn a spoken idea into a musical brief

Dictating a request describes intent. Singing or humming a guide supplies performance information. Keep those inputs separate: “sing this more softly” is a direction; a recorded melody contains pitches and rhythm that can be transcribed or used as a guide.

A useful first brief might be:

> Make an original eight-bar progressive-house hook at 126 BPM in D minor. Use a warm low-mid voice with an airy start, clear consonants, and restrained vibrato. Keep the words sparse. Produce a soft version, a firmer version, and an instrumental space where the phrase can resolve. Preserve the melody and singer across versions. Keep the lead dry and provide effects separately.

Specify the voice using **register, tone color, diction, language, breathiness, intensity, vibrato, and production treatment**. If using an identifiable performer or custom voice, record the permission that supports the intended recordings, transformations, and release. “Dark” should become a concrete direction such as reduced brightness, a lower register, or a less forward delivery; those options have different musical consequences.

Record the following before generating takes:

| Brief field | Example decision |
| --- | --- |
| Musical role | A short hook with space between statements, rather than continuous verses. |
| Harmony | D-minor family with an explicitly approved chord timeline. |
| Time | 126 BPM, 4/4, eight-bar region, any pickup described separately. |
| Text | Approved original lyric, exact words, language, pronunciation notes. |
| Performance | Stable melody, restrained ornamentation, soft and firm intensity variants. |
| Identity | One named project voice profile and a particular approved model or performer. |
| Delivery | Dry lead, optional doubles/harmony, separate effects, instrumental continuation. |
| Intended use | Personal audition, finished song, or publicly reusable stem bundle. |

At constant tempo, eight bars of 4/4 at 126 BPM occupy **8 × 4 × 60 / 126 = 15.238095… seconds**. That is the grid region, not permission to cut off a pickup or reverb tail. Preserve musical positions and derive sample boundaries at the declared sample rate; do not accumulate rounded phrase durations.

## 2. Choose a production lane and an eligible voice

Use **score-controlled synthesis** when the melody, words, and exact rhythmic placement matter most. Use **text-to-song generation** when searching for a performance or arrangement that has not yet been composed. Use **voice conversion** when a guide already performs the right material and a different authorized vocal timbre is desired.

For the first public pack, a self-recorded or commissioned performance with the required permissions is a straightforward asset source. A synthetic voice can also work when the full dependency set supports the intended use. That set may include the editor, acoustic model, variance models, vocoder, reference audio, and voicebank terms.

Check the intended *form of distribution*. A tool may permit a released song while restricting reusable isolated phrases. Dreamtonics’ standard voice terms explicitly restrict sample-pack distribution. OpenVPI’s community vocoder releases identify noncommercial/share-alike weight terms. These facts require a specific choice of eligible assets; they do not justify treating all locally generated audio alike. Sources: [Dreamtonics terms](https://dreamtonics.com/terms/), [OpenVPI vocoder releases](https://github.com/openvpi/vocoders/releases).

Use a stable internal voice-profile identifier to keep production organized. That identifier does not rename a licensed voice, establish exclusivity, or guarantee that a generative model will reproduce the same singer.

## 3. Lane A: compose and render a controlled vocal

### Build the score before polishing the sound

Create a short melody against the actual harmony and groove. Place the important vowels on the intended musical beats, then allow consonants to lead into them where the performance requires it. Allocate words to syllables and decide where one syllable stretches across several notes. Include rests and breaths deliberately.

Check register and phrasing with a simple reference instrument or guide before asking a voice engine to perform it. Long sustained vowels, dense consonant clusters, rapid syllables, large leaps, and register changes are useful audition cases. They expose different weaknesses; a convincing held “ah” does not establish clear delivery of a full lyric.

OpenUtau’s documented USTX format represents notes, lyrics, phoneme overrides, pitch, vibrato, and expression curves. This makes an editable project a plausible interchange point for an assistant, provided the adapter follows the actual application version and verifies that the saved file opens correctly. Source: [USTX format](https://openutau.com/USTX-file-format/).

### Render a neutral reference, then make expressive variants

Start with a dry, intelligible rendition using one approved voice. Resolve wrong words and note placement first. Then shape the delivery: a slightly firmer attack, controlled breathiness, a particular vibrato onset, or a more intense vowel. Keep the musical phrase recognizable across versions.

For DiffSinger in OpenUtau, available expression controls depend on the selected bank and vocoder. Inspect those capabilities before planning an automation curve. Rendering quality/speed settings also require audition on the actual configuration. Source: [DiffSinger support](https://openutau.com/DiffSinger-support/).

Save neutral, soft, and firm versions as separate revisions. Record which edits are intentional. Avoid rerandomizing every parameter at once: if a variant changes voice, melody, phrasing, and effects, it becomes difficult to learn which change improved the result.

### Bring the performance into FL Studio

Import the dry render, align it to the same musical origin as the accompaniment, and listen with the intended kick, bass, and harmony. Edit pronunciation or performance in the source singing project when practical; use the DAW for arrangement, processing, and mix decisions. Keep the editable source and the accepted audio together in the production record.

An assistant can prepare a score file or operate an available editor through supported tools. The workflow does not assume that merely naming FL Studio grants programmatic access to every plugin. Initially, a verified file import/export path is enough.

## 4. Lane B: generate, select, and refine musical sections

Text-to-song tools are useful when the brief specifies a destination but not every note. Give the model enough context to develop a phrase: the lyric, broad arrangement, intended voice qualities, and the role of the section. Keep each candidate’s prompt and settings.

ACE-Step documents captions, structured lyrics, tempo/key/duration inputs, reference material, and selective editing operations. YuE2 exposes an editable symbolic planning route. These are candidate controls to evaluate; they do not establish exact compliance on an untested generation. Sources: [ACE musician guide](https://github.com/ace-step/ACE-Step-1.5/blob/main/docs/en/ace_step_musicians_guide.md), [YuE2 generation interface](https://github.com/multimodal-art-projection/YuE).

A bounded first batch could contain three or four candidates from the same brief. Listen to all of them at comparable loudness. Choose a performance because the words, melody, voice, and groove work together. Record why alternatives failed rather than quietly presenting only the winning take as representative quality.

Once a useful phrase exists, freeze its identity and musical context. A later request should say what stays fixed and what changes: “keep this lyric and melodic contour; use a less forceful delivery.” Use only documented reference or editing controls, with eligible reference audio. Independently generated clips may change singers or pronunciation even with identical descriptive prompts. If continuity cannot be preserved, use a larger approved section or move the accepted melody into the score-controlled lane.

Generated timestamps and BPM/key estimates are starting annotations. Verify them against the audio and the actual harmonic timeline. A nominally correct key does not prove that every note works over every chord in that key.

If the tool outputs a mixture, prefer any usable native stems it can provide. Otherwise, source separation can produce candidate component tracks, but audition exposed vocals carefully. Bleed, softened consonants, modulation artifacts, and missing breath detail may make a separated result unsuitable for a sparse arrangement. Check the selected separator’s weight terms too; [Demucs’ author fork](https://github.com/adefossez/demucs) explicitly distinguishes its MIT code from unclear pretrained-weight licensing.

## 5. Lane C: convert an authorized guide performance

Begin with a guide that already has the intended words, melody, timing, and expression. Record it dry enough that effects do not become part of the performance analysis. Keep the original. Choose a legitimate voice model and document whether its terms cover conversion and the intended asset release.

Run conversion as an offline candidate-producing job. Inspect the pitch tracking where available: octave errors, unstable unvoiced regions, and difficult register transitions can affect the result. Change a small number of parameters at a time and compare the converted phrase with the guide. RVC’s documentation describes pitch extraction and retrieval-based conversion; its realtime interface is not a requirement for this library workflow. Source: [RVC documentation](https://github.com/RVC-Project/Retrieval-based-Voice-Conversion-WebUI/blob/main/docs/en/README.en.md).

Pitch and vocal color need separate attention. A semitone change alters the musical notes; a formant or timbre operation changes the perceived vocal color. Neither should be used as a blind substitute for the other. Listen for altered vowels, unstable sibilants, doubled attacks, and a voice that changes identity halfway through a phrase.

Do not assume that a proprietary synthesized guide may be fed into another voice system. For example, the linked Dreamtonics voice EULA restricts renditions as inputs to voice-generation workflows. Select a guide source that permits the actual transformation. Source: [Dreamtonics voice EULA](https://dreamtonics.com/wp-content/uploads/2025/02/SynthesizerV_VDB_EULA_ALL.txt).

## 6. Build a coherent vocal family

A recipe should have several useful musical versions, not merely many randomized files. For one hook, a first family could contain:

| Variant | Intended role | Relationship to the family |
| --- | --- | --- |
| Dry lead | Reference and mix flexibility | Establishes the approved words, notes, timing, and singer. |
| Soft lead | Sparse or reflective arrangement | Preserves the phrase with a gentler approved performance. |
| Firm lead | Higher-energy arrangement | Adds intensity without changing the identity arbitrarily. |
| Harmony or response | Selected expanded sections | Authored against the same chord timeline. |
| Wordless texture | A less verbally prominent section | Uses compatible vowels and harmony with reviewed reuse rules. |
| Instrumental continuation | A safe space after a vocal | Preserves groove and harmonic direction while the voice rests. |

These are proposed roles, not a requirement that every model can generate each one reliably. A few convincing variants are more valuable than a large set that cannot transition musically.

Constrain any runtime variation. Let the director select approved phrases, entrances, accompaniment density, and effect levels within tested ranges. Avoid choosing arbitrary syllables independently; both meaning and pronunciation span boundaries. A chopped-vocal recipe can deliberately break words, but its chop points and combinations should be authored and auditioned as that aesthetic.

For the first pack, prefer rendered tempo or pitch alternatives over wide realtime transformations of lead vocals. This makes singer identity and consonants inspectable during production. The eventual player can expand transform ranges only after the specific voice and asset pass listening checks.

## 7. Export assets with musical boundaries

Retain the highest-quality useful production source, then create the pack’s declared delivery format. If a pack selects 48 kHz audio, convert deliberately and keep the original render. Declare mono versus stereo, sample count, sample rate, and the common musical origin. Do not infer alignment from filenames alone.

In FL Studio, the render range, song/pattern choice, mixer routing, and tail settings affect the exported file. The manual documents individual mixer-track export and separate handling of effect tails. Verify the actual output: exporting every mixer channel is not automatically the same as producing an independent, correctly routed stem bundle. Source: [FL Studio export documentation](https://www.image-line.com/fl-studio-learning/fl-studio-online-manual/html/fformats_save_export.htm).

For each vocal asset, retain the following information:

- Its place in the arrangement: phrase start, pickup, first intended downbeat, lyric end, and safe exit.
- Tempo, meter, key or tonal center, and the chord region it was authored against.
- The lyric text and reviewed word or syllable timing where useful.
- Which singer/profile and variant it belongs to, and which combinations are compatible.
- Dry/wet status, effect-tail duration, common export origin, and any required gain compensation.
- Original source, render revision, model/voice dependencies, settings, file hash, and permission record.

Keep a breath that belongs to the next phrase with that phrase. Keep a reverb tail audible after the lead stops without treating it as a new lyric. A looping region, an entry handle, and an exit tail can have different lengths and purposes. Test them in the actual intended transition, not only by soloing each file.

The audio player should finish a meaningful phrase before ordinary state-driven replacement. A request to reduce intensity can first affect the accompaniment, then change the vocal at its next approved boundary. Immediate user stop or mute remains immediate. If a replacement is unavailable, continue the approved instrumental path or existing arrangement; never wait for an inference job in the audio path.

## 8. Evaluate the vocal before accepting it

Use a repeatable listening pass. Review the dry voice, its intended mix, and the transitions. Match audition loudness sufficiently that a louder take does not automatically win. Listen on the devices that matter to the owner.

The following is a proposed review rubric. Scores are **0: reject**, **1: major repair**, **2: minor repair**, **3: acceptable for this use**. A mean score must not hide an unintelligible lyric or an obvious broken edit.

| Dimension | Listen or inspect for | A useful repair direction |
| --- | --- | --- |
| Pronunciation | Correct words, consonants, vowel identity, language, and stress. | Edit phonemes or syllable allocation; rerender the phrase. |
| Pitch and harmony | Intended notes, stable sustained pitch, deliberate slides, no octave mistakes. | Correct the score or guide; inspect pitch tracking; verify chords. |
| Timing | Vowels land musically; consonants lead naturally; breaths and endings fit. | Adjust phoneme timing or source performance before aggressive warping. |
| Formants and timbre | A plausible, stable voice across register changes and alternate versions. | Change voice settings, transformation range, or the source take. |
| Expression | Dynamics, vibrato, attacks, releases, and emphasis match the brief. | Make targeted expressive edits while preserving the phrase. |
| Continuity | Singer, room, level, accent, and tone remain coherent between sections. | Reuse an approved source context or regenerate a larger connected section. |
| Artifacts | No distracting clicks, fizz, warble, metallic tails, bleed, or phantom syllables. | Return to the source; compare separation or synthesis settings. |
| Mix behavior | Voice works with bass, percussion, effects, and optional harmony. | Adjust arrangement and mix; evaluate exposed and dense versions. |
| Transition behavior | No cut words, stacked lyrics, truncated breaths, or mismatched releases. | Revise transition edges, handles, or the instrumental bridge. |

Automated checks can flag clipping, unexpected silence, durations, channel mismatches, file integrity, or candidate pitch discrepancies. Alignment tools can propose lyric boundaries. These are aids to review, not substitutes for hearing expression or understanding a word. Mark analysis confidence and keep corrected annotations.

For the first accepted bundle, require every intended lyric to be understood, every transition to be heard in context, and every material defect to be resolved or explicitly excluded from the supported use. Do not claim model superiority from one chosen sample. Report the number of attempts, the acceptance rate for this brief, and the repair effort.

## 9. Preserve the production record

Save the approved brief, lyric and score versions, input recordings, renderer identity, model/checkpoint identifiers, auxiliary dependencies, seed/settings, and all accepted outputs. When a tool cannot reproduce an identical render, the accepted audio is the stable reference. Keep failed attempts when they explain a capability limit.

A useful revision note is concrete: “Take B fixes the final consonant; melody unchanged; two-bar tail retained; firm variant rejected because the singer changes.” That is more valuable than “improved quality.” Record audition decisions separately from estimated measurements.

For public distribution, package only assets with established permissions for that form of release. Preserve attributions and restrictions in the pack record. Keep private consent records and sensitive source recordings out of the public repository; publish an appropriate provenance summary. Do not include proprietary plugin binaries, voice databases, credentials, or automatically downloaded model weights.

## 10. A first experiment with a clear finish

Choose one original hook, one voice, one harmonic setting, and one tempo. Produce a neutral take and two intentional variations. Build a small stem bundle with an instrumental continuation, then audition entry, repetition, intensity change, and exit.

The experiment is complete when an owner can hear the musical differences, select a preferred version, and play a short adaptive sequence without broken words or unexplained changes of singer. Deliver the editable project, accepted assets, musical boundary annotations, dependency and permission record, render measurements, and the review sheet. Record unresolved limitations honestly before expanding to more voices or genres.
