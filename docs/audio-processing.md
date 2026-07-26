# Offline audio processing

The dedicated worker invokes FFprobe and FFmpeg with argument arrays and
`shell=False`. Uploaded names never become output names. Each job uses an
isolated `swaram-audio-*` temporary directory containing deterministic
`source.input`, `normalized_playback.wav`, and `analysis_mono.wav` paths.

FFprobe verifies the actual audio stream, duration, channels, codec, and sample
rate before decode. Configured input-size, duration, command-time, and
single-thread limits bound work. Playback normalization produces stereo
44.1 kHz 16-bit PCM; pitch analysis receives a separate mono 22.05 kHz 16-bit
PCM file. Temporary workspaces remove all files on both success and exception.

Worker failures use stable codes such as `audio_probe_failed`,
`audio_decode_failed`, `audio_too_long`, and `audio_tool_timeout`. Captured
stderr is bounded and remains server-side.

## Pretrained stem separation

Install the optional `services/worker[audio-ml]` dependencies to use pinned
Demucs 4.0.1, PyTorch/Torchaudio 2.9.1, TorchCodec 0.9.1, and the pretrained
`htdemucs` model. The worker
defaults to CPU; `auto`, `cuda`, and `mps` are explicit deployment options.
Inference creates private `vocals.wav` and `instrumental.wav` derivatives in
the job workspace, records the model identifier, and removes Demucs' temporary
tree on success or failure. There are no stem download endpoints.

The expensive integration check is opt-in:

```bash
RUN_AUDIO_INTEGRATION=1 \
SWARAM_AUTHORIZED_AUDIO=/absolute/path/to/normalized.wav \
pytest services/worker/tests/test_stem_separation.py
```

## Durable pipeline

The PostgreSQL worker claims one leased job, reports named progress stages,
normalizes the private input, runs HTDemucs, extracts the vocal contour,
computes timing metadata, and stores private normalized audio, stems, and a
compact `AnalysisPackageV1`. Only after every object is written does one
database transaction publish derivative records, the versioned package, and
the succeeded job state. Failed publication removes partial objects.

The input checksum plus pipeline version identifies an existing completed
package, so retries do not rerun inference or create duplicate packages.
Transient tool timeouts retry up to three attempts; deterministic decode,
model, or validation failures store a stable user-safe code while detailed
tracebacks remain server-side. Job workspaces are temporary and always
removed. Raw pYIN frames remain in worker memory for debugging and are excluded
from serialized packages.

Configure the worker with the shared `PRIVATE_DATA_ROOT` and optional
`STEM_DEVICE=cpu|auto|cuda|mps`. The API never serves vocal stems; only original
or instrumental playback is eligible for its authorized range endpoint.
