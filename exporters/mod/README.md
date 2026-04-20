# OpenMPT Stem Exporter

This folder contains a native CLI exporter for MOD/XM/S3M/IT style tracker modules using libopenmpt.

Current behavior:

1. Renders one `master.wav` per input module
2. Renders one stereo float WAV stem per tracker channel
3. Writes basic metadata to `meta/song.json`

## Build

```bash
cd exporters/mod
bash build.sh
```

## Usage

```bash
./export_openmpt_stems --output-dir renders path/to/song.xm
./export_openmpt_stems --output-dir renders path/to/song1.xm path/to/song2.it
```

Optional flags:

```text
--samplerate N   Output sample rate in Hz. Default: 48000
--stereo N       Stereo separation in percent. Default: 100
--filter N       Interpolation taps. One of 1, 2, 4, 8. Default: 8
--end-time SEC   Stop rendering after SEC seconds
```

## Output Layout

```text
renders/
  Song_xm/
    master.wav
    stems/
      channel_01.wav
      channel_02.wav
      ...
    meta/
      song.json
```

## Notes

1. WAV is treated as the canonical rendered format.
2. The exporter currently writes 32-bit float stereo WAV files.
3. Channel stems are produced by muting all channels except the target channel via the libopenmpt interactive extension.
4. This is the first implementation. Optional FLAC or ALAC conversion can be layered on later as a second step.