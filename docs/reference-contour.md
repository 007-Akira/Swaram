# Offline reference contour

The worker CLI analyzes WAV input at 22,050 Hz with `librosa.pyin`. It emits
integer millisecond timestamps, Hz, continuous MIDI, voicing confidence, and
explicit unvoiced frames. The cleaned contour applies confidence gating,
short-gap interpolation, and median smoothing; `raw_pitch_frames` retains the
unsmoothed detector output for private debugging.

The prototype confidence gate defaults to `0.1`, selected for the authorized
mixed reference recording. Use `--confidence-threshold` to raise it for cleaner
isolated vocals; downstream scoring must still ignore low-confidence frames.

Normalize authorized source material before analysis:

```bash
ffmpeg -i input.mp3 -ac 1 -ar 22050 -c:a pcm_s16le reference.wav
```

Generate the versioned package:

```bash
.venv/bin/swaram-reference-contour \
  private-media/reference/test_audio.prototype.wav \
  private-media/analysis/test_audio.analysis-v1.json \
  --session-id f88c2a2b-1d5a-4c27-b4b9-38c320a14821
```

The input and output contain private user-derived data and must not be committed
to the public application repository.
