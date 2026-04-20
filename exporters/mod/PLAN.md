# MOD/XM/IT Exporter Plan

## Goal

Build an offline exporter for tracker modules, focused first on XM and IT, using OpenMPT/libopenmpt as the rendering engine.

Primary target:

- Accurate batch rendering of single tracks or many tracks from the library
- Outputs that are useful in Logic Pro and FL Studio
- Deterministic, lossless export workflow

## Recommended Direction

The best first implementation is:

1. Offline CLI-based exporter
2. OpenMPT/libopenmpt renderer for MOD/XM/S3M/IT
3. Per-channel stem export
4. WAV output first
5. Optional FLAC or ALAC conversion after rendering

This gives the highest practical accuracy with the least ambiguity.

## Why OpenMPT

For MOD/XM/S3M/IT, OpenMPT/libopenmpt is the strongest practical renderer for faithful playback and offline export.

Reasons:

1. Native understanding of tracker formats and playback semantics
2. Good handling of tracker-specific timing and effects
3. Suitable for deterministic offline rendering
4. Better fit than trying to rebuild tracker playback inside a DAW

## Best Export Format For Logic Or FL Studio

The best target is not a native Logic or FL Studio project file. The best target is a stem set.

Recommended format:

1. One WAV file per tracker channel
2. All files aligned to 0:00
3. Same sample rate and bit depth for all outputs
4. Optional master render for reference

Recommended WAV settings:

1. 32-bit float WAV if available
2. Otherwise 24-bit PCM WAV
3. 48 kHz preferred for modern DAW work
4. 44.1 kHz acceptable if desired for music-production compatibility
5. No normalization by default
6. No dither when staying in float

## Recommended Stem Mode

### Default: Per-Channel Stems

Per-channel stems means one output file per tracker channel.

Example:

- A 16-channel XM becomes 16 audio files
- Each file contains everything played on that channel over the whole song

Why this is the best default:

1. Closest to how the tracker song was composed
2. Preserves channel-based arrangement logic
3. Best archival and analysis format
4. Most faithful representation for import into Logic or FL Studio

### Alternative: Per-Instrument Stems

Per-instrument stems means one output file per instrument, combining all uses of that instrument across all channels.

Why it is useful:

1. Easier for remixing by sound source
2. Fewer files than per-channel export in some songs
3. Easier to manipulate sound families in a DAW

Why it is not the default:

1. Loses the original channel architecture
2. Merges events that may have been deliberately separated in the tracker
3. Less faithful to original composition structure

### Recommendation

If only one mode is implemented first, implement per-channel stems first.

## Difference Between Per-Channel And Per-Instrument

### Per-Channel

- One audio file for each tracker channel
- Preserves arrangement structure
- Best for studying or reconstructing the original song layout
- Best fidelity to tracker playback organization

### Per-Instrument

- One audio file for each instrument or sample source
- Combines that source across all channels
- Better for remixing by source
- Less faithful to the original channel-based sequencing model

### Rule Of Thumb

1. Most accurate DAW representation: per-channel
2. Easier remix workflow: per-instrument

## Single-Track Export Feasibility

Single-track offline export is fully feasible.

Recommended outputs:

1. WAV: easiest and best first target
2. FLAC: feasible after WAV render using a second step
3. ALAC in M4A: feasible as a second-stage conversion, but not necessary for first version

Practical guidance:

1. Render tracker playback to PCM first
2. Write WAV directly
3. Optionally convert WAV to FLAC or ALAC afterward

## Batch Export Feasibility

Exporting many tracks individually is also feasible offline with CLI.

This is much more practical in CLI form than in-browser because:

1. No browser download limits
2. No tab lifetime issues
3. Better control over output folders and naming
4. Better resumability and logging
5. More reliable for large libraries

## Best Output Types

### Best Default Output

1. Per-channel WAV stems
2. One folder per song
3. Optional master WAV render

### Good Secondary Output

1. Per-instrument WAV stems
2. Useful for remix-oriented workflows

### Not Recommended As Primary Exchange Format

1. MIDI plus samples
2. Native DAW session conversion
3. AAF/OMF style interchange

These lose too much tracker-specific behavior or add complexity without equivalent benefit.

## Suggested Export Folder Layout

For each song:

```text
Song Name/
  master.wav
  stems/
    channel_01.wav
    channel_02.wav
    channel_03.wav
  instruments/
    instrument_01.wav
    instrument_02.wav
  meta/
    song.json
    notes.txt
```

Minimum first version:

```text
Song Name/
  master.wav
  stems/
    channel_01.wav
    channel_02.wav
    ...
```

## Suggested Metadata To Save

Useful sidecar metadata:

1. Original file path
2. Original module format
3. Title, tracker, artist if available
4. Sample rate
5. Bit depth / float mode
6. Channel count
7. Export mode: per-channel or per-instrument
8. OpenMPT render settings
9. Duration
10. Repeat and fade settings

## Recommended Render Settings

These should be fixed and documented so exports are deterministic.

Suggested defaults:

1. Repeat count: 0
2. No normalization
3. Fixed sample rate: 48000 or 44100
4. Fixed bit depth: 32-bit float preferred
5. Fixed interpolation setting
6. Fixed stereo separation setting
7. Explicit fade policy for naturally looping modules

Important:

- These settings must be chosen once and kept stable if the export output is intended to be reproducible.

## Alternatives Considered

### Alternative 1: Browser Exporter

Feasible for small jobs, but not the preferred path.

Problems:

1. Poor fit for large batches
2. Hard to manage many output files
3. Browser download and memory constraints
4. Worse reliability on long-running jobs

### Alternative 2: FLAC As Primary Output

Feasible, but not ideal for first implementation.

Why not first:

1. Adds encoder complexity
2. DAWs handle WAV more naturally
3. WAV is the simpler archival/export foundation

Recommendation:

- Render WAV first, convert to FLAC as optional second step

### Alternative 3: ALAC M4A As Primary Output

Technically valid for lossless delivery, but not the best working format for the exporter.

Why not first:

1. Less natural than WAV for DAW workflows
2. Adds another conversion step
3. Not better than WAV for editing or stem import

Recommendation:

- Only offer ALAC as an optional post-process format if needed

### Alternative 4: Per-Instrument As Primary Stem Mode

Useful, but not the most faithful first export mode.

Why not first:

1. Loses tracker channel structure
2. Merges playback that was intentionally separated in composition
3. Less ideal for analysis and archival

Recommendation:

- Implement as optional second mode after per-channel export works well

### Alternative 5: MIDI Plus Samples

Not recommended for faithful interchange.

Why not:

1. Tracker playback behavior does not map cleanly to MIDI
2. Many XM/IT effects and timing behaviors are lost
3. Requires manual reconstruction in the DAW

Recommendation:

- Do not use as the main export workflow

## Proposed Implementation Phases

### Phase 1

Build the simplest accurate exporter:

1. Single-track master WAV export
2. Single-track per-channel WAV stem export
3. Stable output naming
4. Metadata sidecar

### Phase 2

Add batch capability:

1. Export selected files from a manifest or folder
2. Sequential processing
3. Log file for successes and failures
4. Resume support

### Phase 3

Add alternative outputs:

1. Optional FLAC conversion
2. Optional ALAC conversion
3. Optional per-instrument stems

### Phase 4

Add convenience features:

1. Export presets
2. Track filtering
3. Channel naming if metadata allows it
4. Sample and instrument extraction for reference

## Practical First-Version Recommendation

If scope must stay tight, build exactly this:

1. CLI exporter for XM/IT using OpenMPT
2. Output directory per song
3. Per-channel 32-bit float WAV stems
4. One master WAV
5. One JSON metadata file
6. Sequential batch mode

That is the cleanest and most defensible first version.

## Final Recommendation

The best overall plan is:

1. Use OpenMPT/libopenmpt offline via CLI
2. Export per-channel WAV stems as the primary deliverable
3. Treat WAV as the canonical rendered format
4. Add FLAC or ALAC only as optional conversions
5. Add per-instrument stems later as an alternate mode

For Logic Pro or FL Studio, this will be more accurate and more useful than trying to generate a native DAW project.